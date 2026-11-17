import { NestFactory } from "@nestjs/core";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.js";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { JwtService } from "@nestjs/jwt";
import { AppModule } from "./app.module.js";
import { runInHousehold } from "./prisma/prisma.service.js";

export interface AppOptions {
  rateLimitMax?: number;
  /** Demandes de lien de réinitialisation (envoi d'e-mail), par minute et par IP. */
  resetLimitMax?: number;
  /** Connexion, inscription, codes 2FA, changement et réinitialisation de mot de passe, par minute et par IP. */
  authLimitMax?: number;
}

/** Routes d'authentification exposées à la force brute : plafond dédié, compteur à part. */
const AUTH_ATTEMPT_ROUTES = ["/auth/login", "/auth/register", "/auth/2fa/enable", "/auth/password/reset", "/auth/password/change"];
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Protection CSRF en plus des cookies SameSite=Strict : une requête qui modifie des données doit venir de l'application
 * elle-même. Refusée si le navigateur la déclare inter-sites (`Sec-Fetch-Site: cross-site`) ou si son `Origin` n'est ni
 * l'hôte appelé, ni `APP_URL`, ni une origine de `CSRF_TRUSTED_ORIGINS`. Sans `Origin` (outil en ligne de commande), aucun
 * cookie de navigateur n'est en jeu.
 */
export function csrfRejection(method: string, headers: Record<string, string | string[] | undefined>): string | null {
  if (!UNSAFE_METHODS.has(method)) return null;
  if (headers["sec-fetch-site"] === "cross-site") return "cross-site";
  const origin = headers.origin;
  if (typeof origin !== "string") return null;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return "origin";
  }
  const allowed = [headers["x-forwarded-host"], headers.host, process.env.APP_URL, ...(process.env.CSRF_TRUSTED_ORIGINS ?? "").split(",")]
    .flatMap((v) => (typeof v === "string" && v.trim() ? [v.trim()] : []))
    .map((v) => { try { return new URL(v.includes("://") ? v : `http://${v}`).host; } catch { return v; } });
  return allowed.includes(host) ? null : "origin";
}

export async function createApp(opts: AppOptions = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: process.env.TRUST_PROXY === "1" }), { logger: process.env.NODE_ENV === "test" ? false : ["error", "warn"], abortOnError: false });
  app.useGlobalFilters(new AllExceptionsFilter(app.getHttpAdapter()));
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(cookie);
  // Foyer de la requête : lu dans le jeton d'accès (signature vérifiée) et conservé pendant toute la requête.
  // La RLS PostgreSQL ne montre ensuite que les lignes de ce foyer ; sans jeton valide, aucun accès aux tables du foyer.
  // L'authentification et les rôles restent contrôlés par AuthGuard.
  const jwt = app.get(JwtService);
  app.getHttpAdapter().getInstance().addHook("onRequest", (req, _reply, done) => {
    const token = (req as { cookies?: Record<string, string | undefined> }).cookies?.access;
    let householdId: string | undefined;
    try {
      householdId = token ? jwt.verify<{ householdId?: string }>(token).householdId : undefined;
    } catch {
      householdId = undefined;
    }
    if (householdId) runInHousehold(householdId, done);
    else done();
  });
  // CSRF : avant toute autre lecture de la requête (voir csrfRejection).
  app.getHttpAdapter().getInstance().addHook("onRequest", (req, reply, done) => {
    if (csrfRejection(req.method, req.headers)) {
      void reply.code(403).send({ statusCode: 403, message: "Requête refusée : elle ne provient pas de l'application." });
      return;
    }
    done();
  });
  // Données financières : aucune réponse de l'API n'est gardée en cache (navigateur, proxy).
  app.getHttpAdapter().getInstance().addHook("onSend", (_req, reply, payload, done) => {
    void reply.header("Cache-Control", "no-store");
    done(null, payload);
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
  // L'import de PDF (coûteux) a son propre plafond et son propre compteur, par IP.
  const isUpload = (url: string) => url.startsWith("/payslips/parse");
  // Plafonds dédiés, chacun avec son compteur par IP : demandes de lien de réinitialisation (5/min), tentatives
  // d'authentification (10/min, en plus du verrouillage du compte après 5 échecs), imports de PDF (10/min).
  const buckets = [
    { name: "reset", max: opts.resetLimitMax ?? 5, match: (url: string) => url.startsWith("/auth/password/forgot") },
    { name: "auth", max: opts.authLimitMax ?? 10, match: (url: string) => AUTH_ATTEMPT_ROUTES.some((r) => url.startsWith(r)) },
    { name: "upload", max: 10, match: isUpload },
  ];
  const bucket = (url: string) => buckets.find((b) => b.match(url));
  await app.register(rateLimit, {
    max: (req) => bucket(req.url)?.max ?? opts.rateLimitMax ?? 100,
    keyGenerator: (req) => { const b = bucket(req.url); return b ? `${b.name}:${req.ip}` : req.ip; },
    timeWindow: "1 minute",
  });
  return app;
}
