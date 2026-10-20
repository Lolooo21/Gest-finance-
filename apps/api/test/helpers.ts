import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { createApp } from "../src/app.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

export async function startApp(rateLimitMax = 1000) {
  const app = await createApp({ rateLimitMax });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export async function resetDb(app: NestFastifyApplication) {
  const prisma = app.get(PrismaService);
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.household.deleteMany();
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
