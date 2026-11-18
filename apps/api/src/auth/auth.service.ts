import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException, ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import type { ChangePasswordDto, LoginDto, MemberPasswordDto, RegisterDto, ResetPasswordDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { MailSender } from "../mail/mail.sender.js";
import { passwordProblem } from "./password-policy.js";
import { PrismaService, SystemPrismaService } from "../prisma/prisma.service.js";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const REFRESH_DAYS = 14;
const RESET_MINUTES = 30;
const TOTP_STEP_MS = 30_000;
// Tolérance d'un pas (30 s) de part et d'autre pour l'horloge du téléphone ; l'anti-rejeu empêche de réutiliser un code dans cette fenêtre.
authenticator.options = { window: 1 };

/** Pas TOTP du code s'il est valide (fenêtre ± 1 pas), sinon null. */
const totpStep = (code: string, secret: string): number | null => {
  const delta = authenticator.checkDelta(code, secret);
  return delta === null ? null : Math.floor(Date.now() / TOTP_STEP_MS) + delta;
};
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Inscription, connexion, rotation des jetons : opérations d'avant connexion, donc sans foyer connu → client « système ».
 * Les opérations d'un utilisateur déjà connecté (TOTP) passent par le client soumis à la RLS.
 */
export interface Session {
  access: string;
  refresh: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailSender,
  ) {}

  hashPassword(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /**
   * L'inscription crée un NOUVEAU foyer : ouverte tant qu'aucun foyer n'existe (première installation), puis fermée, sauf
   * `ALLOW_REGISTRATION=1`. Les membres d'un foyer sont ajoutés par son propriétaire.
   */
  async registrationOpen(): Promise<boolean> {
    if (process.env.ALLOW_REGISTRATION === "1") return true;
    return (await this.system.household.count()) === 0;
  }

  /** Refuse un mot de passe trop faible, avec une raison claire. */
  assertStrongPassword(password: string, context: string[]) {
    const problem = passwordProblem(password, context);
    if (problem) throw new BadRequestException(problem);
  }

  async register(dto: RegisterDto): Promise<Session> {
    if (!(await this.registrationOpen())) throw new ForbiddenException("Inscription fermée : demandez au propriétaire du foyer de vous ajouter.");
    this.assertStrongPassword(dto.password, [dto.email, dto.displayName, dto.householdName]);
    const exists = await this.system.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException("Inscription impossible");
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.system.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash,
        role: "OWNER",
        household: { create: { name: dto.householdName } },
      },
    });
    await this.audit.record(user.householdId, user.id, "auth.register");
    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<Session> {
    const user = await this.system.user.findUnique({ where: { email: dto.email } });
    // Même erreur et même coût (hash) que l'utilisateur existe ou non : pas d'énumération de comptes.
    if (!user) {
      await argon2.hash(dto.password, { type: argon2.argon2id });
      throw new UnauthorizedException("Identifiants invalides");
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException("Compte temporairement verrouillé");
    }
    const passwordOk = await argon2.verify(user.passwordHash, dto.password);
    // Anti-rejeu : un code TOTP déjà utilisé (même pas de 30 s ou antérieur) est refusé, même encore « valide ».
    const step = user.totpEnabled && dto.totp && user.totpSecret ? totpStep(dto.totp, user.totpSecret) : null;
    const totpOk = !user.totpEnabled || (step !== null && (user.totpLastStep === null || step > user.totpLastStep));
    if (!passwordOk || !totpOk) {
      await this.registerFailure(user.id, user.householdId, user.failedLogins + 1);
      throw new UnauthorizedException("Identifiants invalides");
    }
    await this.system.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, ...(step !== null ? { totpLastStep: step } : {}) } });
    await this.audit.record(user.householdId, user.id, "auth.login");
    return this.issueSession(user);
  }

  /**
   * Mot de passe oublié : envoie un lien à usage unique (30 min) si le compte existe. Rien ne permet de savoir si l'adresse
   * est inscrite (même réponse, même délai côté client) ; un nouveau lien annule les précédents.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.system.user.findUnique({ where: { email } });
    if (!user) return;
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await this.system.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await this.system.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000) },
    });
    const link = `${(process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "")}/?reinitialisation=${token}`;
    const sent = await this.mail.send({
      to: user.email,
      subject: "Gest-finance : réinitialisation de votre mot de passe",
      text: [
        `Bonjour ${user.displayName},`,
        "",
        "Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, une seule fois) :",
        link,
        "",
        "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.",
      ].join("\n"),
    });
    await this.audit.record(user.householdId, user.id, sent ? "auth.password_reset_requested" : "auth.password_reset_not_sent");
  }

  /** Nouveau mot de passe depuis un lien valide : déverrouille le compte et ferme toutes les sessions ouvertes. */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const record = await this.system.passwordResetToken.findUnique({ where: { tokenHash: sha256(dto.token) }, include: { user: true } });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw new BadRequestException("Lien invalide ou expiré : demandez-en un nouveau.");
    this.assertStrongPassword(dto.password, [record.user.email, record.user.displayName]);
    // Usage unique, même en cas de double envoi simultané : seul le premier marquage réussit.
    const { count } = await this.system.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!count) throw new BadRequestException("Lien invalide ou expiré : demandez-en un nouveau.");
    await this.system.user.update({
      where: { id: record.userId },
      data: { passwordHash: await this.hashPassword(dto.password), failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } },
    });
    await this.closeAllSessions(record.userId);
    await this.audit.record(record.user.householdId, record.userId, "auth.password_reset");
  }

  /**
   * Changement de mot de passe d'un utilisateur connecté : l'ancien est exigé (un échec compte comme un échec de connexion).
   * Toutes les sessions sont fermées, puis une nouvelle est ouverte pour l'appareil en cours.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<Session> {
    const user = await this.system.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      await this.registerFailure(user.id, user.householdId, user.failedLogins + 1);
      throw new BadRequestException("Mot de passe actuel incorrect");
    }
    this.assertStrongPassword(dto.newPassword, [user.email, user.displayName]);
    const updated = await this.system.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(dto.newPassword), failedLogins: 0, sessionVersion: { increment: 1 } },
    });
    await this.closeAllSessions(userId);
    await this.audit.record(user.householdId, userId, "auth.password_changed");
    return this.issueSession(updated);
  }

  /** Rotation : l'ancien refresh token est révoqué ; sa réutilisation révoque toute la famille de l'utilisateur. */
  async refresh(token: string): Promise<Session> {
    const record = await this.system.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!record || record.expiresAt < new Date()) throw new UnauthorizedException();
    if (record.revokedAt) {
      // Jeton volé probable : toutes les sessions sont fermées, jetons d'accès compris.
      await this.system.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.system.user.update({ where: { id: record.userId }, data: { sessionVersion: { increment: 1 } } });
      await this.audit.record(record.user.householdId, record.userId, "auth.refresh_reuse_detected");
      throw new UnauthorizedException();
    }
    await this.system.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueSession(record.user);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.system.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async setupTotp(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret, totpEnabled: false } });
    return { secret, otpauthUrl: authenticator.keyuri(user.email, "Gest-finance", secret) };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const step = user.totpSecret ? totpStep(code, user.totpSecret) : null;
    if (step === null) throw new UnauthorizedException("Code invalide");
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true, totpLastStep: step } });
    await this.audit.record(user.householdId, userId, "auth.totp_enabled");
  }

  /**
   * Le propriétaire redonne l'accès à un membre qui a oublié son mot de passe, sans e-mail : son propre mot de passe est
   * exigé (une erreur compte comme un échec de connexion). Le membre est déverrouillé et toutes ses sessions sont fermées.
   */
  async resetMemberPassword(ownerId: string, memberId: string, dto: MemberPasswordDto): Promise<void> {
    const owner = await this.system.user.findUniqueOrThrow({ where: { id: ownerId } });
    const member = await this.system.user.findFirst({ where: { id: memberId, householdId: owner.householdId } });
    if (!member) throw new NotFoundException("Membre introuvable");
    if (member.id === owner.id) throw new BadRequestException("Pour votre propre compte, utilisez « Changer le mot de passe »");
    if (!(await argon2.verify(owner.passwordHash, dto.ownerPassword))) {
      await this.registerFailure(owner.id, owner.householdId, owner.failedLogins + 1);
      throw new BadRequestException("Votre mot de passe est incorrect");
    }
    this.assertStrongPassword(dto.password, [member.email, member.displayName]);
    await this.system.user.update({
      where: { id: member.id },
      data: { passwordHash: await this.hashPassword(dto.password), failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } },
    });
    await this.closeAllSessions(member.id);
    await this.audit.record(owner.householdId, owner.id, `household.member_password_reset:${member.role}`);
  }

  /**
   * Redemande le mot de passe avant une action sensible (export, effacement, retrait d'un membre). Compte verrouillé : refus ;
   * erreur : comptée comme un échec de connexion (verrouillage au 5e).
   */
  async verifyPassword(userId: string, password: string): Promise<void> {
    const user = await this.system.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException("Compte verrouillé : réessayez dans quelques minutes");
    if (!(await argon2.verify(user.passwordHash, password))) {
      await this.registerFailure(user.id, user.householdId, user.failedLogins + 1);
      throw new BadRequestException("Mot de passe incorrect");
    }
  }

  /**
   * Ferme toutes les sessions après un changement de mot de passe : jetons de rafraîchissement révoqués ET expirés, pour qu'un
   * autre appareil qui tente encore de s'en servir soit simplement refusé, sans déclencher la détection de vol (qui couperait
   * aussi la session qu'on vient d'ouvrir).
   */
  private async closeAllSessions(userId: string) {
    const now = new Date();
    await this.system.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, expiresAt: now } });
  }

  private async registerFailure(userId: string, householdId: string, failed: number) {
    const lock = failed >= MAX_FAILED;
    await this.system.user.update({
      where: { id: userId },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await this.audit.record(householdId, userId, lock ? "auth.locked" : "auth.login_failed");
  }

  private async issueSession(user: { id: string; householdId: string; role: "OWNER" | "ADULT" | "CHILD"; sessionVersion: number }): Promise<Session> {
    const access = await this.jwt.signAsync({ userId: user.id, householdId: user.householdId, role: user.role, sv: user.sessionVersion });
    const refresh = randomBytes(32).toString("base64url");
    await this.system.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000) },
    });
    return { access, refresh };
  }
}
