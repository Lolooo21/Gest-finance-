import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { admin, get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

type Cookies = { access: string };
const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const put = (url: string, payload: object, cookies: Cookies) => app.inject({ method: "PUT", url, payload, cookies });
const del = (url: string, cookies: Cookies) => app.inject({ method: "DELETE", url, cookies });
const today = () => new Date().toISOString().slice(0, 10);
const list = async (c: Cookies) => (await get(app, "/goals/behavior", c)).json() as { kind: string; capCents: number | null; current: { status: string; valueCents: number }; history: unknown[]; streak: number }[];
const spend = async (c: Cookies, amountCents: number) => {
  const accountId = (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 50_000 }, c)).json().id as string;
  await post(app, "/transactions", { accountId, amountCents, date: today(), label: "Gros achat" }, c);
};

describe("objectifs de comportement", () => {
  it("exige une session et commence sans objectif", async () => {
    expect((await get(app, "/goals/behavior")).statusCode).toBe(401);
    expect(await list(await register())).toEqual([]);
  });

  it("active, modifie et supprime un objectif ; le plafond n'existe que pour les dépenses", async () => {
    const c = await register();
    expect((await put("/goals/behavior/NO_OVERDRAFT", {}, c)).statusCode).toBe(200);
    expect((await put("/goals/behavior/NO_OVERDRAFT", { capCents: 5_000 }, c)).statusCode).toBe(400);
    expect((await put("/goals/behavior/SPENDING_CAP", {}, c)).statusCode).toBe(400);
    expect((await put("/goals/behavior/SPENDING_CAP", { capCents: -1 }, c)).statusCode).toBe(400);
    expect((await put("/goals/behavior/INCONNU", {}, c)).statusCode).toBe(400);
    expect((await put("/goals/behavior/SPENDING_CAP", { capCents: 80_000 }, c)).statusCode).toBe(200);
    expect((await put("/goals/behavior/SPENDING_CAP", { capCents: 90_000 }, c)).statusCode).toBe(200);

    const goals = await list(c);
    expect(goals.map((g) => [g.kind, g.capCents])).toEqual([["NO_OVERDRAFT", null], ["SPENDING_CAP", 90_000]]);
    expect(goals.every((g) => g.history.length === 0 && g.streak === 0)).toBe(true);

    expect((await del("/goals/behavior/NO_OVERDRAFT", c)).statusCode).toBe(204);
    expect((await del("/goals/behavior/NO_OVERDRAFT", c)).statusCode).toBe(404);
    expect((await list(c)).map((g) => g.kind)).toEqual(["SPENDING_CAP"]);
  });

  it("évalue le mois en cours selon les opérations", async () => {
    const calm = await register(1);
    await put("/goals/behavior/NO_OVERDRAFT", {}, calm);
    await put("/goals/behavior/POSITIVE_REMAINING", {}, calm);
    await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 50_000 }, calm);
    expect((await list(calm)).map((g) => [g.kind, g.current.status])).toEqual([["NO_OVERDRAFT", "ON_TRACK"], ["POSITIVE_REMAINING", "ON_TRACK"]]);

    const spender = await register(2);
    await spend(spender, -100_000);
    await put("/goals/behavior/NO_OVERDRAFT", {}, spender);
    await put("/goals/behavior/POSITIVE_REMAINING", {}, spender);
    await put("/goals/behavior/SPENDING_CAP", { capCents: 80_000 }, spender);
    const byKind = Object.fromEntries((await list(spender)).map((g) => [g.kind, g.current]));
    expect(byKind.NO_OVERDRAFT).toMatchObject({ status: "FAILED", valueCents: -50_000 });
    expect(byKind.POSITIVE_REMAINING).toMatchObject({ status: "FAILED", valueCents: -100_000 });
    expect(byKind.SPENDING_CAP).toMatchObject({ status: "FAILED", valueCents: 100_000 });
  });

  it("interdit l'écriture à un enfant mais autorise la lecture, et journalise sans montant", async () => {
    const a = await register();
    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, a);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    expect((await put("/goals/behavior/NO_OVERDRAFT", {}, child)).statusCode).toBe(403);
    expect((await del("/goals/behavior/NO_OVERDRAFT", child)).statusCode).toBe(403);
    await put("/goals/behavior/SPENDING_CAP", { capCents: 123_456 }, a);
    expect((await get(app, "/goals/behavior", child)).statusCode).toBe(200);
    const actions = (await admin.auditLog.findMany()).map((l) => l.action);
    expect(actions).toContain("goal.behavior_set:SPENDING_CAP");
    expect(JSON.stringify(actions)).not.toContain("123456");
  });

  it("est isolé par foyer", async () => {
    const a = await register(1);
    const b = await register(2);
    await put("/goals/behavior/SPENDING_CAP", { capCents: 50_000 }, a);
    expect(await list(b)).toEqual([]);
    expect((await del("/goals/behavior/SPENDING_CAP", b)).statusCode).toBe(404);
    expect(await list(a)).toHaveLength(1);
  });
});
