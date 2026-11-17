import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { admin, get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const member = { email: "lea@example.com", displayName: "Léa", password: "cheval-agrafe-batterie", role: "ADULT" };
const login = (email: string, password: string) => post(app, "/auth/login", { email, password });
const NEW_PASSWORD = "girafe-orange-velo-nuage";

describe("administration du foyer", () => {
  it("indique à chacun qui il est et son rôle", async () => {
    const a = await register();
    expect((await get(app, "/household/me", a)).json()).toEqual({ id: expect.any(String), email: owner().email, displayName: "Owner 1", role: "OWNER" });
    await post(app, "/household/members", member, a);
    const lea = { access: sessionCookies(await login(member.email, member.password)).access! };
    expect((await get(app, "/household/me", lea)).json()).toMatchObject({ email: member.email, role: "ADULT" });
    expect((await get(app, "/household/me")).statusCode).toBe(401);
  });

  it("le propriétaire redonne l'accès à un membre : déverrouillé, sessions fermées, ancien mot de passe refusé", async () => {
    const a = await register();
    const id = (await post(app, "/household/members", member, a)).json().id;
    const lea = sessionCookies(await login(member.email, member.password));
    for (let i = 0; i < 5; i++) await login(member.email, "oubli-total-du-mot");
    expect((await login(member.email, member.password)).statusCode).toBe(403);

    const reset = await post(app, `/household/members/${id}/password`, { ownerPassword: owner().password, password: NEW_PASSWORD }, a);
    expect(reset.statusCode).toBe(200);
    expect((await get(app, "/accounts", { access: lea.access! })).statusCode).toBe(401);
    expect((await post(app, "/auth/refresh", undefined, { refresh: lea.refresh! })).statusCode).toBe(401);
    expect((await login(member.email, member.password)).statusCode).toBe(401);
    expect((await login(member.email, NEW_PASSWORD)).statusCode).toBe(200);
    // Le propriétaire, lui, reste connecté.
    expect((await get(app, "/accounts", a)).statusCode).toBe(200);
    expect(JSON.stringify((await admin.auditLog.findMany()).map((l) => l.action))).toContain("household.member_password_reset:ADULT");
  });

  it("exige le mot de passe du propriétaire, un mot de passe solide, un membre du foyer autre que soi, et le rôle propriétaire", async () => {
    const a = await register();
    const id = (await post(app, "/household/members", member, a)).json().id;
    const url = `/household/members/${id}/password`;
    const wrong = await post(app, url, { ownerPassword: "pas-le-bon", password: NEW_PASSWORD }, a);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toBe("Votre mot de passe est incorrect");
    expect((await admin.user.findFirstOrThrow({ where: { role: "OWNER" } })).failedLogins).toBe(1);
    expect((await post(app, url, { ownerPassword: owner().password, password: "Motdepasse2026" }, a)).statusCode).toBe(400);
    expect((await post(app, url, { ownerPassword: owner().password, password: "court" }, a)).statusCode).toBe(400);

    const me = (await get(app, "/household/me", a)).json().id;
    expect((await post(app, `/household/members/${me}/password`, { ownerPassword: owner().password, password: NEW_PASSWORD }, a)).json().message).toMatch(/Changer le mot de passe/);
    const b = await register(2);
    expect((await post(app, url, { ownerPassword: owner(2).password, password: NEW_PASSWORD }, b)).statusCode).toBe(404);
    expect((await post(app, "/household/members/pas-un-uuid/password", { ownerPassword: owner().password, password: NEW_PASSWORD }, a)).statusCode).toBe(400);

    const lea = { access: sessionCookies(await login(member.email, member.password)).access! };
    expect((await post(app, url, { ownerPassword: member.password, password: NEW_PASSWORD }, lea)).statusCode).toBe(403);
    // Rien n'a changé pour Léa.
    expect((await login(member.email, member.password)).statusCode).toBe(200);
  });
});

describe("journal d'activité", () => {
  it("pagine par 50, du plus récent au plus ancien, avec le nom de l'auteur", async () => {
    const a = await register();
    const owner1 = await admin.user.findFirstOrThrow();
    const base = Date.now() - 3_600_000;
    await admin.auditLog.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({ householdId: owner1.householdId, userId: owner1.id, action: "transaction.created", createdAt: new Date(base + i * 1000) })),
    });
    const first = (await get(app, "/household/audit", a)).json();
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]).toMatchObject({ action: "auth.register", user: "Owner 1" });
    expect(first.next).toBe(first.entries.at(-1).createdAt);
    const second = (await get(app, `/household/audit?before=${encodeURIComponent(first.next)}`, a)).json();
    expect(second.entries).toHaveLength(11);
    expect(second.next).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((e: { id: string }) => e.id)).size).toBe(61);
    expect((await get(app, "/household/audit?before=hier", a)).statusCode).toBe(400);
  });

  it("filtre les événements de sécurité et montre les échecs de connexion", async () => {
    const a = await register();
    await login(owner().email, "mauvais-mot-de-passe");
    await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, a);
    const security = (await get(app, "/household/audit?security=1", a)).json().entries.map((e: { action: string }) => e.action);
    expect(security).toEqual(["auth.login_failed", "auth.register"]);
    expect(security).not.toContain("account.created");
    expect((await get(app, "/household/audit?security=oui", a)).statusCode).toBe(400);
  });
});
