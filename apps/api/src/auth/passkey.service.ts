import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomBytes } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService, SystemPrismaService } from "../prisma/prisma.service.js";
import { AuthService, type Session } from "./auth.service.js";

/** Durée de validité d'une cérémonie WebAuthn (le temps de toucher le capteur). */
const CEREMONY_MS = 5 * 60_000;
const MAX_PENDING = 1_000;

interface Ceremony { challenge: string; purpose: "register" | "login"; userId?: string; expires: number }

/** Origine et identifiant de site (rpID) attendus par l'appareil : `APP_URL` en production, sinon l'origine de la requête (vérifiée par la protection CSRF). */
export function relyingParty(origin: string | undefined): { origin: string; rpID: string } {
  const source = process.env.APP_URL?.trim() || origin;
  if (!source) throw new BadRequestException("Origine de la requête inconnue");
  try {
    const url = new URL(source);
    return { origin: url.origin, rpID: url.hostname };
  } catch {
    throw new BadRequestException("Origine de la requête invalide");
  }
}

/**
 * Passkeys (WebAuthn) : ajout depuis une session ouverte (mot de passe redemandé), connexion sans mot de passe ni code 2FA
 * (la passkey exige la vérification de l'utilisateur sur l'appareil : empreinte, visage ou code, donc deux facteurs).
 * Les défis sont gardés en mémoire, à usage unique, 5 minutes ; le navigateur n'en reçoit qu'un identifiant aléatoire (cookie).
 * Une seule instance de l'API est prévue (comme le planificateur de rappels).
 */
@Injectable()
export class PasskeyService {
  private readonly ceremonies = new Map<string, Ceremony>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  private start(ceremony: Omit<Ceremony, "expires">): string {
    const now = Date.now();
    for (const [id, c] of this.ceremonies) if (c.expires < now) this.ceremonies.delete(id);
    if (this.ceremonies.size >= MAX_PENDING) throw new ForbiddenException("Trop de demandes en cours, réessayez dans quelques minutes");
    const id = randomBytes(24).toString("base64url");
    this.ceremonies.set(id, { ...ceremony, expires: now + CEREMONY_MS });
    return id;
  }

  /** Retire la cérémonie (usage unique) et la renvoie si elle est valide pour cet usage. */
  private take(id: string | undefined, purpose: Ceremony["purpose"]): Ceremony {
    const c = id ? this.ceremonies.get(id) : undefined;
    if (id) this.ceremonies.delete(id);
    if (!c || c.purpose !== purpose || c.expires < Date.now()) throw new BadRequestException("Demande expirée : recommencez");
    return c;
  }

  async registrationOptions(userId: string, password: string, origin: string | undefined) {
    await this.auth.verifyPassword(userId, password);
    const rp = relyingParty(origin);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, displayName: true } });
    const existing = await this.prisma.passkey.findMany({ where: { userId }, select: { credentialId: true, transports: true } });
    const options = await generateRegistrationOptions({
      rpName: "Gest-finance",
      rpID: rp.rpID,
      userName: user.email,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    return { options, ceremony: this.start({ challenge: options.challenge, purpose: "register", userId }) };
  }

  async register(userId: string, householdId: string, ceremonyId: string | undefined, response: RegistrationResponseJSON, name: string, origin: string | undefined) {
    const c = this.take(ceremonyId, "register");
    if (c.userId !== userId) throw new BadRequestException("Demande expirée : recommencez");
    const rp = relyingParty(origin);
    const result = await verifyRegistrationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
    }).catch(() => ({ verified: false as const }));
    if (!result.verified) throw new BadRequestException("Passkey refusée par la vérification");
    const { credential } = result.registrationInfo;
    const passkey = await this.prisma.passkey.create({
      data: { userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [], name },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    await this.audit.record(householdId, userId, "auth.passkey_added");
    return passkey;
  }

  async loginOptions(origin: string | undefined) {
    const rp = relyingParty(origin);
    // Passkeys « découvrables » : l'appareil propose les comptes de ce site, aucun identifiant à saisir.
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
    return { options, ceremony: this.start({ challenge: options.challenge, purpose: "login" }) };
  }

  async login(ceremonyId: string | undefined, response: AuthenticationResponseJSON, origin: string | undefined): Promise<Session> {
    const c = this.take(ceremonyId, "login");
    const rp = relyingParty(origin);
    const passkey = await this.system.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
    if (!passkey) throw new UnauthorizedException("Passkey inconnue : ajoutez-la depuis Plus → Passkeys après vous être connecté");
    const { user } = passkey;
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException("Compte temporairement verrouillé");
    const result = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
      credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports as AuthenticatorTransportFuture[] },
    }).catch(() => null);
    if (!result?.verified) {
      await this.audit.record(user.householdId, user.id, "auth.passkey_failed");
      throw new UnauthorizedException("Passkey refusée");
    }
    await this.system.passkey.update({ where: { id: passkey.id }, data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() } });
    await this.system.user.update({ where: { id: user.id }, data: { failedLogins: 0 } });
    await this.audit.record(user.householdId, user.id, "auth.passkey_login");
    return this.auth.issueSession(user);
  }

  list(userId: string) {
    return this.prisma.passkey.findMany({ where: { userId }, select: { id: true, name: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: "asc" } });
  }

  async remove(userId: string, householdId: string, id: string) {
    const { count } = await this.prisma.passkey.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException("Passkey introuvable");
    await this.audit.record(householdId, userId, "auth.passkey_removed");
  }
}
