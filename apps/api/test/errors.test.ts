import { HttpException, Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

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

describe("PrismaService au démarrage", () => {
  const service = (count: () => Promise<unknown>) => {
    const s = new PrismaService();
    s.$connect = async () => undefined;
    Object.defineProperty(s, "user", { value: { count } });
    return s;
  };

  it("explique comment migrer quand les tables sont absentes", async () => {
    await expect(service(async () => { throw Object.assign(new Error("x"), { code: "P2021" }); }).onModuleInit()).rejects.toThrow(/prisma migrate deploy/);
    await expect(service(async () => { throw Object.assign(new Error("x"), { code: "P2022" }); }).onModuleInit()).rejects.toThrow(/prisma generate/);
  });

  it("laisse passer les autres erreurs et démarre si le schéma est migré", async () => {
    await expect(service(async () => { throw new Error("réseau"); }).onModuleInit()).rejects.toThrow("réseau");
    await expect(service(async () => 0).onModuleInit()).resolves.toBeUndefined();
  });
});
