import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { authenticator } from "otplib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, owner, post, resetDb, sessionCookies, startApp, admin } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

describe("inscription et connexion", () => {
  it("inscrit un propriétaire, pose des cookies HttpOnly/Strict et stocke un hash Argon2id", async () => {
    const res = await post(app, "/auth/register", owner());
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === "access")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    const user = await admin.user.findFirstOrThrow();
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain("passwordHash");
  });

  it("refuse un mot de passe trop court et un e-mail invalide", async () => {
    expect((await post(app, "/auth/register", { ...owner(), password: "court" })).statusCode).toBe(400);
    expect((await post(app, "/auth/register", { ...owner(), email: "pas-un-mail" })).statusCode).toBe(400);
  });

  it("répond identiquement pour un compte inconnu et un mauvais mot de passe", async () => {
    await post(app, "/auth/register", owner());
    const bad = await post(app, "/auth/login", { email: owner().email, password: "mauvais-mot-de-passe" });
    const unknown = await post(app, "/auth/login", { email: "inconnu@example.com", password: "mauvais-mot-de-passe" });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().message).toBe(unknown.json().message);
  });

  it("verrouille le compte après 5 échecs", async () => {
    await post(app, "/auth/register", owner());
    for (let i = 0; i < 5; i++) await post(app, "/auth/login", { email: owner().email, password: "mauvais-mot-de-passe" });
    const locked = await post(app, "/auth/login", { email: owner().email, password: owner().password });
    expect(locked.statusCode).toBe(403);
  });
});

describe("refresh token", () => {
  it("fait tourner le token et révoque tout en cas de réutilisation", async () => {
    const reg = await post(app, "/auth/register", owner());
    const first = sessionCookies(reg);
    const rotated = await post(app, "/auth/refresh", undefined, { refresh: first.refresh! });
    expect(rotated.statusCode).toBe(200);
    const second = sessionCookies(rotated);
    const replay = await post(app, "/auth/refresh", undefined, { refresh: first.refresh! });
    expect(replay.statusCode).toBe(401);
    const afterReplay = await post(app, "/auth/refresh", undefined, { refresh: second.refresh! });
    expect(afterReplay.statusCode).toBe(401);
  });

  it("invalide le refresh token après déconnexion", async () => {
    const reg = await post(app, "/auth/register", owner());
    const s = sessionCookies(reg);
    await post(app, "/auth/logout", undefined, s as Record<string, string>);
    expect((await post(app, "/auth/refresh", undefined, { refresh: s.refresh! })).statusCode).toBe(401);
  });
});

describe("2FA TOTP", () => {
  it("exige le code après activation", async () => {
    const reg = await post(app, "/auth/register", owner());
    const s = sessionCookies(reg);
    const setup = await post(app, "/auth/2fa/setup", undefined, { access: s.access! });
    const { secret } = setup.json();
    expect((await post(app, "/auth/2fa/enable", { code: "000000" }, { access: s.access! })).statusCode).toBe(401);
    expect((await post(app, "/auth/2fa/enable", { code: authenticator.generate(secret) }, { access: s.access! })).statusCode).toBe(200);

    const noCode = await post(app, "/auth/login", { email: owner().email, password: owner().password });
    expect(noCode.statusCode).toBe(401);
    const withCode = await post(app, "/auth/login", { ...{ email: owner().email, password: owner().password }, totp: authenticator.generate(secret) });
    expect(withCode.statusCode).toBe(200);
  });
});

describe("accès protégé", () => {
  it("refuse sans cookie ou avec un jeton falsifié", async () => {
    expect((await get(app, "/household/members")).statusCode).toBe(401);
    expect((await get(app, "/household/members", { access: "faux.jeton.ici" })).statusCode).toBe(401);
  });
});
