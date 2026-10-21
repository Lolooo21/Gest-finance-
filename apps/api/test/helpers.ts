import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { createApp } from "../src/app.js";
import { PrismaClient } from "@prisma/client";

export async function startApp(rateLimitMax = 1000) {
  const app = await createApp({ rateLimitMax });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Connexion propriétaire (hors RLS) : réservée aux tests, pour préparer et vérifier les données. L'API, elle, n'a jamais ce rôle. */
export const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_OWNER_URL });

// Le paramètre est conservé pour les appelants existants (resetDb(app)) : la base se vide avec la connexion propriétaire.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resetDb(_app?: NestFastifyApplication) {
  await admin.auditLog.deleteMany();
  await admin.refreshToken.deleteMany();
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
