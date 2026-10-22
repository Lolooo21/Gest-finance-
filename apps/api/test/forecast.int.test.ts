import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const newAccount = async (c: { access: string }, extra: object = {}) =>
  (await post(app, "/accounts", { name: "Compte courant", type: "CHECKING", initialBalanceCents: 50_000, ...extra }, c)).json().id as string;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const forecast = (c: { access: string }, days?: number) => get(app, `/forecast${days ? `?days=${days}` : ""}`, c);

describe("prévisionnel de trésorerie", () => {
  it("exige une session, refuse un horizon inconnu et utilise 30 jours par défaut", async () => {
    expect((await get(app, "/forecast")).statusCode).toBe(401);
    const c = await register();
    expect((await forecast(c, 45)).statusCode).toBe(400);
    const res = await forecast(c);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ days: 30, accounts: [], events: [], firstNegativeDate: null });
    expect(res.json().points).toHaveLength(31);
  });

  it("projette les opérations datées dans le futur et détecte le premier découvert", async () => {
    const c = await register();
    const courant = await newAccount(c);
    await newAccount(c, { name: "Livret A", type: "SAVINGS", initialBalanceCents: 200_000 });
    await post(app, "/transactions", { accountId: courant, amountCents: -100_000, date: inDays(5), label: "Travaux" }, c);
    await post(app, "/transactions", { accountId: courant, amountCents: 300_000, date: inDays(40), label: "Prime" }, c);

    const f30 = (await forecast(c, 30)).json();
    expect(f30.startCents).toBe(250_000);
    expect(f30.endCents).toBe(150_000);
    expect(f30.firstNegativeDate).toBe(inDays(5));
    expect(f30.lowestCheckingCents).toBe(-50_000);
    expect(f30.events.map((e: { label: string; account: string }) => [e.label, e.account])).toEqual([["Travaux", "Compte courant"]]);
    expect(f30.accounts.map((a: { name: string; type: string }) => [a.name, a.type])).toEqual([["Compte courant", "CHECKING"], ["Livret A", "SAVINGS"]]);

    const f60 = (await forecast(c, 60)).json();
    expect(f60.endCents).toBe(450_000);
    expect(f60.incomeCents).toBe(300_000);
    expect(f60.points).toHaveLength(61);
  });

  it("ne compte pas ce qui est déjà dans le solde d'aujourd'hui et inclut les règles récurrentes à venir", async () => {
    const c = await register();
    const courant = await newAccount(c);
    await post(app, "/transactions", { accountId: courant, amountCents: -10_000, date: inDays(-3), label: "Passé" }, c);
    await post(app, "/recurring-rules", { accountId: courant, label: "Abonnement", amountCents: -1_000, frequency: "WEEKLY", start: inDays(1) }, c);
    const f = (await forecast(c, 30)).json();
    expect(f.startCents).toBe(40_000);
    expect(f.events.length).toBeGreaterThanOrEqual(4);
    expect(f.expensesCents).toBe(f.events.length * 1_000);
    expect(f.endCents).toBe(40_000 - f.events.length * 1_000);
  });

  it("est lisible par un enfant et isolé par foyer", async () => {
    const a = await register(1);
    const compteA = await newAccount(a);
    await post(app, "/transactions", { accountId: compteA, amountCents: -90_000, date: inDays(2), label: "Secret A" }, a);
    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, a);
    const login = await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" });
    const child = { access: sessionCookies(login).access! };
    expect((await forecast(child)).json().events.map((e: { label: string }) => e.label)).toEqual(["Secret A"]);
    const b = await register(2);
    const res = (await forecast(b)).json();
    expect(JSON.stringify(res)).not.toContain("Secret A");
    expect(res.accounts).toEqual([]);
  });
});
