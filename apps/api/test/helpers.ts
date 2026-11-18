import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { createApp } from "../src/app.js";
import { PrismaClient } from "@prisma/client";
import { FieldCipher } from "../src/crypto/field-cipher.js";

export async function startApp(rateLimitMax = 1000, resetLimitMax = 1000, authLimitMax = 1000) {
  // Hermétique : des clés VAPID dans l'environnement ou le .env de la machine activeraient les notifications push.
  // Valeurs vides plutôt que `delete` : le client Prisma recharge apps/api/.env à sa création et ne remplace que les variables ABSENTES.
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.VAPID_SUBJECT = "";
  // Idem pour l'e-mail : aucun envoi réel depuis les tests (les tests remplacent l'envoi par un espion).
  process.env.SMTP_URL = "";
  process.env.APP_URL = "";
  // Les tests créent plusieurs foyers : inscription ouverte (fermée par défaut dès qu'un foyer existe ; testé à part).
  process.env.ALLOW_REGISTRATION = "1";
  // Pas d'état de sauvegarde sauf dans les tests qui en créent un.
  process.env.BACKUP_STATUS_DIR = "";
  const app = await createApp({ rateLimitMax, resetLimitMax, authLimitMax });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Connexion propriétaire (hors RLS) : réservée aux tests, pour préparer et vérifier les données. L'API, elle, n'a jamais ce rôle. */
export const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_OWNER_URL });

/** Les libellés sont chiffrés en base : la connexion propriétaire les lit chiffrés, les tests les déchiffrent avec la clé de test. */
export const fieldCipher = new FieldCipher();
export const plainLabels = async (where: object = {}) =>
  (await admin.transaction.findMany({ where, select: { label: true } })).map((t) => fieldCipher.decryptField(t.label));

// Le paramètre est conservé pour les appelants existants (resetDb(app)) : la base se vide avec la connexion propriétaire.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resetDb(_app?: NestFastifyApplication) {
  await admin.auditLog.deleteMany();
  await admin.refreshToken.deleteMany();
  await admin.bankAccount.deleteMany();
  await admin.user.deleteMany();
  await admin.household.deleteMany();
}

export function post(app: NestFastifyApplication, url: string, payload?: unknown, cookies?: Record<string, string>) {
  return app.inject({ method: "POST", url, payload: payload as object, cookies });
}

export function get(app: NestFastifyApplication, url: string, cookies?: Record<string, string>) {
  return app.inject({ method: "GET", url, cookies });
}

export function sessionCookies(res: LightMyRequestResponse): Record<string, string> {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
}

export const owner = (n = 1) => ({
  email: `owner${n}@example.com`,
  password: "correct-horse-battery",
  displayName: `Owner ${n}`,
  householdName: `Foyer ${n}`,
});
