import { HttpException, Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter.js";
import { PrismaConnections } from "../src/prisma/prisma.service.js";

const fakeHost = () => {
  const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
  return { reply, host: { switchToHttp: () => ({ getResponse: () => reply }) } as never };
};

afterEach(() => vi.restoreAllMocks());

describe("AllExceptionsFilter", () => {
  it("journalise la cause d'une erreur inattendue sans fuiter les valeurs, et répond de façon générique", () => {
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, "error").mockImplementation((m) => void logged.push(String(m)));
    const error = Object.assign(new Error("Invalid `prisma.user.create()` invocation:\n{ email: 'secret@example.com', passwordHash: '$argon2id$xyz' }\nUnique constraint failed on the fields: (`email`)"), { name: "PrismaClientKnownRequestError", code: "P2002" });
    const { reply, host } = fakeHost();
    new AllExceptionsFilter().catch(error, host);

    expect(logged[0]).toContain("PrismaClientKnownRequestError [P2002]");
    expect(logged[0]).toContain("Unique constraint failed on the fields");
    expect(logged[0]).not.toContain("secret@example.com");
    expect(logged[0]).not.toContain("argon2id");
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 500, message: "Erreur interne du serveur" });
  });

  it("conserve le statut des erreurs client de Fastify (429, 413…) au lieu de les transformer en 500", () => {
    const { reply, host } = fakeHost();
    new AllExceptionsFilter().catch(Object.assign(new Error("Rate limit exceeded, retry in 1 minute"), { statusCode: 429 }), host);
    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith({ statusCode: 429, message: "Rate limit exceeded, retry in 1 minute" });
  });

  it("laisse les erreurs HTTP normales suivre leur chemin habituel", () => {
    const { host } = fakeHost();
    const filter = new AllExceptionsFilter();
    const parent = vi.spyOn(Object.getPrototypeOf(AllExceptionsFilter.prototype), "catch").mockImplementation(() => undefined);
    const e = new HttpException("Interdit", 403);
    filter.catch(e, host);
    expect(parent).toHaveBeenCalledWith(e, host);
  });
});

describe("PrismaConnections au démarrage", () => {
  const MODELS = ["user", "bankAccount", "transaction", "recurringRule", "reminderSetting", "pushSubscription", "payslipImport", "marketSnapshot", "auditLog", "refreshToken", "behaviorGoal", "savingsGoal", "savingsContribution"];
  const delegates = (failing?: { model: string; code?: string; message?: string }, missing?: string) => {
    const o: Record<string, unknown> = {};
    for (const model of [...MODELS, "household", "refreshToken", "auditLog"]) {
      const fails = failing?.model === model;
      o[model] = missing === model ? undefined : { count: async () => { if (fails) throw Object.assign(new Error(failing.message ?? "x"), { code: failing.code }); return 0; } };
    }
    return o;
  };
  const client = (role: { name: string; bypass?: boolean; super?: boolean }, extra: Record<string, unknown> = {}) => ({
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => [{ name: role.name, bypass: role.bypass ?? false, super: role.super ?? false }],
    ...extra,
  });
  const connections = (failing?: { model: string; code?: string; message?: string }, missing?: string, roles = { app: "gest_app", system: "gest_system" }) =>
    new PrismaConnections(
      client({ name: roles.app }, delegates(undefined, missing)) as never,
      client({ name: roles.system }, delegates()) as never,
      delegates(failing) as never,
    );

  it("indique le modèle manquant et comment migrer, quelle que soit la table absente", async () => {
    await expect(connections({ model: "user", code: "P2021" }).onModuleInit()).rejects.toThrow(/« user ».*prisma migrate deploy/);
    await expect(connections({ model: "bankAccount", code: "P2021" }).onModuleInit()).rejects.toThrow(/« bankAccount »/);
    await expect(connections({ model: "payslipImport", code: "P2022" }).onModuleInit()).rejects.toThrow(/prisma generate/);
  });

  it("explique qu'il faut régénérer le client Prisma quand un modèle est absent du client", async () => {
    await expect(connections(undefined, "marketSnapshot").onModuleInit()).rejects.toThrow(/« marketSnapshot ».*prisma generate/);
  });

  it("laisse passer les autres erreurs et démarre si le schéma est migré", async () => {
    await expect(connections({ model: "transaction", message: "réseau" }).onModuleInit()).rejects.toThrow("réseau");
    await expect(connections().onModuleInit()).resolves.toBeUndefined();
  });

  it("refuse de démarrer si DATABASE_URL n'est pas le rôle gest_app (la RLS serait contournée)", async () => {
    await expect(connections(undefined, undefined, { app: "gest", system: "gest_system" }).onModuleInit()).rejects.toThrow(/DATABASE_URL doit utiliser le rôle « gest_app ».*« gest »/);
    const bypass = new PrismaConnections(client({ name: "gest_app", bypass: true }, delegates()) as never, client({ name: "gest_system" }, delegates()) as never, delegates() as never);
    await expect(bypass.onModuleInit()).rejects.toThrow(/sans contournement de la RLS/);
  });

  it("refuse de démarrer si DATABASE_SYSTEM_URL n'est pas le rôle gest_system", async () => {
    await expect(connections(undefined, undefined, { app: "gest_app", system: "gest" }).onModuleInit()).rejects.toThrow(/DATABASE_SYSTEM_URL doit utiliser le rôle « gest_system »/);
  });
});
