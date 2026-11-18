import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as webauthn from "@simplewebauthn/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, owner, resetDb, sessionCookies, startApp } from "./helpers.js";

// La signature d'un vrai appareil ne peut pas être produite ici : seules les deux vérifications cryptographiques sont simulées,
// tout le reste (défis, cookies, droits, stockage, sessions) est réel.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@simplewebauthn/server")>();
  return { ...real, verifyRegistrationResponse: vi.fn(), verifyAuthenticationResponse: vi.fn() };
});
const verifyRegistration = vi.mocked(webauthn.verifyRegistrationResponse);
const verifyAuthentication = vi.mocked(webauthn.verifyAuthenticationResponse);

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app);
  verifyRegistration.mockReset();
  verifyAuthentication.mockReset();
});

const ORIGIN = "https://app.test";
const headers = { host: "app.test", origin: ORIGIN };
type Cookies = Record<string, string>;
const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: object, cookies?: Cookies) =>
  app.inject({ method, url, payload, cookies, headers });

const adult = { email: "adulte@example.com", password: "cheval-agrafe-batterie", displayName: "Sam", role: "ADULT" };
const fakeResponse = (id: string) => ({ id, rawId: id, type: "public-key", response: { clientDataJSON: "x" }, clientExtensionResults: {} });

async function login(email: string, password: string): Promise<Cookies> {
  return sessionCookies(await call("POST", "/auth/login", { email, password }));
}

/** Enregistre une passkey (identifiant `credentialId`) pour la session donnée. */
async function addPasskey(session: Cookies, password: string, credentialId: string, name = "Téléphone") {
  const opts = await call("POST", "/auth/passkeys/register/options", { password }, session);
  verifyRegistration.mockResolvedValueOnce({
    verified: true,
    registrationInfo: { credential: { id: credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } },
  } as never);
  return call("POST", "/auth/passkeys/register", { response: fakeResponse(credentialId), name }, { ...session, webauthn: sessionCookies(opts).webauthn! });
}

describe("passkeys : ajout", () => {
  it("exige le mot de passe, propose une passkey découvrable avec vérification de l'utilisateur, et la stocke", async () => {
    const o = sessionCookies(await call("POST", "/auth/register", owner(1)));
    expect((await call("POST", "/auth/passkeys/register/options", { password: "mauvais-mot-de-passe" }, o)).statusCode).toBe(400);
    expect((await call("POST", "/auth/passkeys/register/options", { password: owner(1).password })).statusCode).toBe(401);

    const opts = await call("POST", "/auth/passkeys/register/options", { password: owner(1).password }, o);
    expect(opts.statusCode).toBe(200);
    expect(opts.json()).toMatchObject({
      rp: { id: "app.test", name: "Gest-finance" }, user: { name: owner(1).email, displayName: owner(1).displayName },
      authenticatorSelection: { residentKey: "required", userVerification: "required" }, attestation: "none",
    });
    const ceremony = sessionCookies(opts).webauthn!;
    expect(opts.cookies.find((c) => c.name === "webauthn")).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/auth/passkeys" });

    verifyRegistration.mockResolvedValueOnce({
      verified: true, registrationInfo: { credential: { id: "cred-1", publicKey: new Uint8Array([9, 8, 7]), counter: 0, transports: ["internal", "hybrid"] } },
    } as never);
    const added = await call("POST", "/auth/passkeys/register", { response: fakeResponse("cred-1"), name: "  iPhone d'Ada " }, { ...o, webauthn: ceremony });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ name: "iPhone d'Ada", lastUsedAt: null });
    expect(verifyRegistration).toHaveBeenCalledWith(expect.objectContaining({ expectedOrigin: ORIGIN, expectedRPID: "app.test", requireUserVerification: true, expectedChallenge: opts.json().challenge }));
    const stored = await admin.passkey.findFirstOrThrow({ where: { credentialId: "cred-1" } });
    expect([...stored.publicKey]).toEqual([9, 8, 7]);
    expect(stored.transports).toEqual(["internal", "hybrid"]);

    // Défi à usage unique : rejouer la même cérémonie est refusé.
    expect((await call("POST", "/auth/passkeys/register", { response: fakeResponse("cred-2"), name: "Autre" }, { ...o, webauthn: ceremony })).statusCode).toBe(400);
    // Une passkey déjà enregistrée est exclue de la prochaine proposition (pas de doublon sur l'appareil).
    const next = await call("POST", "/auth/passkeys/register/options", { password: owner(1).password }, o);
    expect(next.json().excludeCredentials).toEqual([expect.objectContaining({ id: "cred-1" })]);
  });

  it("refuse une réponse non vérifiée, sans cérémonie, ou mal formée", async () => {
    const o = sessionCookies(await call("POST", "/auth/register", owner(1)));
    expect((await call("POST", "/auth/passkeys/register", { response: fakeResponse("c"), name: "x" }, o)).statusCode).toBe(400);
    const opts = await call("POST", "/auth/passkeys/register/options", { password: owner(1).password }, o);
    expect((await call("POST", "/auth/passkeys/register", { response: { id: "c" }, name: "x" }, { ...o, webauthn: sessionCookies(opts).webauthn! })).statusCode).toBe(400);
    const opts2 = await call("POST", "/auth/passkeys/register/options", { password: owner(1).password }, o);
    verifyRegistration.mockResolvedValueOnce({ verified: false } as never);
    expect((await call("POST", "/auth/passkeys/register", { response: fakeResponse("c"), name: "x" }, { ...o, webauthn: sessionCookies(opts2).webauthn! })).statusCode).toBe(400);
    expect(await admin.passkey.count()).toBe(0);
  });

  it("chacun ne voit et ne supprime que ses passkeys, même le propriétaire du foyer", async () => {
    const o = sessionCookies(await call("POST", "/auth/register", owner(1)));
    await call("POST", "/household/members", adult, o);
    const a = await login(adult.email, adult.password);
    await addPasskey(a, adult.password, "cred-sam", "Téléphone de Sam");
    expect((await call("GET", "/auth/passkeys", undefined, o)).json()).toEqual([]);
    const mine = (await call("GET", "/auth/passkeys", undefined, a)).json() as { id: string; name: string }[];
    expect(mine.map((p) => p.name)).toEqual(["Téléphone de Sam"]);
    expect(JSON.stringify(mine)).not.toContain("publicKey");

    expect((await call("DELETE", `/auth/passkeys/${mine[0]!.id}`, undefined, o)).statusCode).toBe(404);
    expect((await call("DELETE", `/auth/passkeys/${mine[0]!.id}`, undefined, a)).statusCode).toBe(204);
    expect(await admin.passkey.count()).toBe(0);
  });
});

describe("passkeys : connexion", () => {
  it("ouvre une session sans mot de passe ni code 2FA, met à jour le compteur et journalise", async () => {
    const o = sessionCookies(await call("POST", "/auth/register", owner(1)));
    await addPasskey(o, owner(1).password, "cred-1");
    await admin.user.updateMany({ data: { totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP" } });

    const opts = await call("POST", "/auth/passkeys/login/options");
    expect(opts.statusCode).toBe(200);
    expect(opts.json()).toMatchObject({ rpId: "app.test", userVerification: "required" });
    expect(opts.json().allowCredentials ?? []).toEqual([]);
    verifyAuthentication.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 7 } } as never);
    const res = await call("POST", "/auth/passkeys/login", { response: fakeResponse("cred-1") }, { webauthn: sessionCookies(opts).webauthn! });
    expect(res.statusCode).toBe(200);
    const session = sessionCookies(res);
    expect((await call("GET", "/household/me", undefined, { access: session.access! })).json()).toMatchObject({ email: owner(1).email });
    expect(verifyAuthentication).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: ORIGIN, expectedRPID: "app.test", requireUserVerification: true, expectedChallenge: opts.json().challenge,
      credential: expect.objectContaining({ id: "cred-1", counter: 0 }),
    }));
    expect(await admin.passkey.findFirstOrThrow({ where: { credentialId: "cred-1" } })).toMatchObject({ counter: 7, lastUsedAt: expect.any(Date) });
    const exported = await call("POST", "/privacy/export", { password: owner(1).password }, { access: session.access! });
    expect(exported.json().passkeys).toEqual([expect.objectContaining({ name: "Téléphone", lastUsedAt: expect.any(String) })]);
    expect(exported.body).not.toContain("cred-1");
    expect((await admin.auditLog.findMany()).map((e) => e.action)).toContain("auth.passkey_login");
  });

  it("refuse une passkey inconnue, une signature invalide, une cérémonie rejouée ou un compte verrouillé", async () => {
    const o = sessionCookies(await call("POST", "/auth/register", owner(1)));
    await addPasskey(o, owner(1).password, "cred-1");
    const start = async () => sessionCookies(await call("POST", "/auth/passkeys/login/options")).webauthn!;

    expect((await call("POST", "/auth/passkeys/login", { response: fakeResponse("inconnue") }, { webauthn: await start() })).statusCode).toBe(401);

    verifyAuthentication.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 0 } } as never);
    const bad = await call("POST", "/auth/passkeys/login", { response: fakeResponse("cred-1") }, { webauthn: await start() });
    expect(bad.statusCode).toBe(401);
    expect(bad.cookies.some((c) => c.name === "access" && c.value)).toBe(false);
    expect((await admin.auditLog.findMany()).map((e) => e.action)).toContain("auth.passkey_failed");

    const used = await start();
    verifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } } as never);
    expect((await call("POST", "/auth/passkeys/login", { response: fakeResponse("cred-1") }, { webauthn: used })).statusCode).toBe(200);
    expect((await call("POST", "/auth/passkeys/login", { response: fakeResponse("cred-1") }, { webauthn: used })).statusCode).toBe(400);
    expect((await call("POST", "/auth/passkeys/login", { response: fakeResponse("cred-1") })).statusCode).toBe(400);

    await admin.user.updateMany({ data: { lockedUntil: new Date(Date.now() + 60_000) } });
    expect((await call("POST", "/auth/passkeys/login", { response: fakeResponse("cred-1") }, { webauthn: await start() })).statusCode).toBe(403);
  });

  it("supprimer un membre supprime ses passkeys", async () => {
    const o = sessionCookies(await call("POST", "/auth/register", owner(1)));
    await call("POST", "/household/members", adult, o);
    const a = await login(adult.email, adult.password);
    await addPasskey(a, adult.password, "cred-sam");
    await call("POST", "/privacy/delete-me", { password: adult.password, confirm: "SUPPRIMER" }, a);
    expect(await admin.passkey.count()).toBe(0);
  });
});
