import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const member = { email: "enfant@example.com", password: "mot-de-passe-enfant-1", displayName: "Léa", role: "CHILD" };

describe("foyer et rôles", () => {
  it("le propriétaire ajoute un membre ; un enfant ne peut pas ajouter ni lire l'audit", async () => {
    const a = sessionCookies(await post(app, "/auth/register", owner(1)));
    const added = await post(app, "/household/members", member, { access: a.access! });
    expect(added.statusCode).toBe(201);
    expect(added.json()).not.toHaveProperty("passwordHash");

    const child = sessionCookies(await post(app, "/auth/login", { email: member.email, password: member.password }));
    const denied = await post(app, "/household/members", { ...member, email: "autre@example.com" }, { access: child.access! });
    expect(denied.statusCode).toBe(403);
    expect((await get(app, "/household/audit", { access: child.access! })).statusCode).toBe(403);
    expect((await get(app, "/household/members", { access: child.access! })).statusCode).toBe(200);
  });

  it("IDOR : un foyer ne voit jamais les membres ni l'audit d'un autre foyer", async () => {
    const a = sessionCookies(await post(app, "/auth/register", owner(1)));
    const b = sessionCookies(await post(app, "/auth/register", owner(2)));
    await post(app, "/household/members", member, { access: a.access! });

    const membersB = (await get(app, "/household/members", { access: b.access! })).json();
    expect(membersB).toHaveLength(1);
    expect(membersB[0].email).toBe(owner(2).email);

    const auditB = (await get(app, "/household/audit", { access: b.access! })).json() as { action: string }[];
    expect(auditB.some((e) => e.action.startsWith("household.member_added"))).toBe(false);
  });

  it("n'enregistre aucun secret dans le journal d'audit", async () => {
    const a = sessionCookies(await post(app, "/auth/register", owner(1)));
    const audit = JSON.stringify((await get(app, "/household/audit", { access: a.access! })).json());
    expect(audit).not.toContain(owner(1).password);
    expect(audit).toContain("auth.register");
  });
});

describe("limitation de débit", () => {
  it("répond 429 au-delà du plafond", async () => {
    const limited = await startApp(3);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.inject({ method: "GET", url: "/health" })).statusCode);
    expect(codes).toContain(429);
    await limited.close();
  });

  it("pose les en-têtes de sécurité", async () => {
    const res = await get(app, "/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});
