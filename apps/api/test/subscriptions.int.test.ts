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
const del = (url: string, cookies: Cookies) => app.inject({ method: "DELETE", url, cookies });
const newAccount = async (c: Cookies) => (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id as string;
const overview = async (c: Cookies) => (await get(app, "/subscriptions", c)).json();

/** Même jour (28 au plus) il y a `k` mois : l'échéance mensuelle de ce mois est toujours passée. */
const now = new Date();
const DAY = Math.min(now.getUTCDate(), 28);
const monthsAgo = (k: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, DAY)).toISOString().slice(0, 10);
const spend = (c: Cookies, accountId: string, date: string, amountCents: number, label: string) =>
  post(app, "/transactions", { accountId, date, amountCents, label, categoryId: null }, c);

async function netflixHistory(c: Cookies, acc: string) {
  for (const k of [3, 2, 1]) await spend(c, acc, monthsAgo(k), -1599, "PRLV SEPA NETFLIX.COM");
  await spend(c, acc, monthsAgo(0), -1799, "PRLV SEPA NETFLIX.COM");
}

describe("abonnements", () => {
  it("exige une session et commence vide", async () => {
    expect((await get(app, "/subscriptions")).statusCode).toBe(401);
    expect(await overview(await register())).toEqual({ candidates: [], drifts: [], dismissed: 0 });
  });

  it("détecte un abonnement oublié avec sa hausse, puis le retire une fois ajouté aux récurrences", async () => {
    const c = await register();
    const acc = await newAccount(c);
    await netflixHistory(c, acc);
    const [found] = (await overview(c)).candidates;
    expect(found).toMatchObject({
      accountId: acc, label: "PRLV SEPA NETFLIX.COM", frequency: "MONTHLY", amountCents: -1799, count: 4,
      lastDate: monthsAgo(0), nextDate: monthsAgo(-1), increase: { fromCents: -1599, toCents: -1799, percent: 13 },
    });

    // « Ajouter aux récurrences » = une règle qui démarre à la prochaine échéance (le passé est déjà saisi).
    const rule = await post(app, "/recurring-rules", { accountId: acc, label: "Netflix", amountCents: found.amountCents, frequency: found.frequency, start: found.nextDate }, c);
    expect(rule.statusCode).toBe(201);
    expect((await overview(c)).candidates).toEqual([]);
  });

  it("ignore une proposition jusqu'à ce qu'on réaffiche les éléments ignorés", async () => {
    const c = await register();
    const acc = await newAccount(c);
    await netflixHistory(c, acc);
    const { key } = (await overview(c)).candidates[0];
    expect((await post(app, "/subscriptions/dismiss", { key }, c)).statusCode).toBe(204);
    expect((await post(app, "/subscriptions/dismiss", { key }, c)).statusCode).toBe(204);
    expect(await overview(c)).toMatchObject({ candidates: [], dismissed: 1 });
    expect((await post(app, "/subscriptions/dismiss", { key: "x" }, c)).statusCode).toBe(400);
    expect((await del("/subscriptions/dismissed", c)).statusCode).toBe(204);
    expect(await overview(c)).toMatchObject({ candidates: [{ key }], dismissed: 0 });
  });

  it("signale la hausse d'une récurrence et l'applique sans réécrire le passé ni compter deux fois", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const rule = (await post(app, "/recurring-rules", { accountId: acc, label: "Netflix", amountCents: -1599, frequency: "MONTHLY", start: monthsAgo(6) }, c)).json();
    const real = (await spend(c, acc, monthsAgo(0), -1799, "PRLV NETFLIX.COM")).json();

    const { drifts } = await overview(c);
    expect(drifts).toEqual([expect.objectContaining({
      ruleId: rule.id, ruleLabel: "Netflix", ruleAmountCents: -1599, transactionId: real.id, observedAmountCents: -1799,
      occurrence: monthsAgo(0), increase: { fromCents: -1599, toCents: -1799, percent: 13 }, key: `drift|${rule.id}|${real.id}`,
    })]);

    const applied = await post(app, `/subscriptions/drifts/${rule.id}/apply`, {}, c);
    expect(applied.statusCode).toBe(201);
    expect(applied.json().start).toBe(monthsAgo(-1));
    const rules = (await get(app, "/recurring-rules", c)).json().map((r: { amountCents: number; start: string; end: string | null }) => [r.amountCents, r.start, r.end]);
    const dayBefore = new Date(Date.parse(`${monthsAgo(0)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    // L'ancien prix vaut jusqu'à la veille de l'échéance que le prélèvement réel remplace ; le nouveau reprend le mois suivant.
    expect(rules).toEqual([[-1599, monthsAgo(6), dayBefore], [-1799, monthsAgo(-1), null]]);
    expect((await overview(c)).drifts).toEqual([]);
    expect((await post(app, `/subscriptions/drifts/${rule.id}/apply`, {}, c)).statusCode).toBe(404);
  });

  it("remplace la règle quand l'écart porte sur sa toute première échéance", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const rule = (await post(app, "/recurring-rules", { accountId: acc, label: "Salle de sport", amountCents: -2990, frequency: "MONTHLY", start: monthsAgo(0) }, c)).json();
    await spend(c, acc, monthsAgo(0), -3490, "PRLV SALLE SPORT");
    expect((await post(app, `/subscriptions/drifts/${rule.id}/apply`, {}, c)).statusCode).toBe(201);
    const rules = (await get(app, "/recurring-rules", c)).json();
    expect(rules.map((r: { amountCents: number; start: string }) => [r.amountCents, r.start])).toEqual([[-3490, monthsAgo(-1)]]);
  });

  it("isole les foyers, interdit l'écriture à un enfant, rappelle les hausses dans le bilan et journalise sans libellé", async () => {
    const a = await register();
    const acc = await newAccount(a);
    await netflixHistory(a, acc);
    const rule = (await post(app, "/recurring-rules", { accountId: acc, label: "Canal", amountCents: -2499, frequency: "MONTHLY", start: monthsAgo(4) }, a)).json();
    await spend(a, acc, monthsAgo(0), -2799, "PRLV CANAL+");

    const b = await register(2);
    expect(await overview(b)).toEqual({ candidates: [], drifts: [], dismissed: 0 });
    expect((await post(app, `/subscriptions/drifts/${rule.id}/apply`, {}, b)).statusCode).toBe(404);

    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, a);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    expect((await overview(child)).candidates).toHaveLength(1);
    expect((await post(app, "/subscriptions/dismiss", { key: "a|out|netflix" }, child)).statusCode).toBe(403);
    expect((await del("/subscriptions/dismissed", child)).statusCode).toBe(403);
    expect((await post(app, `/subscriptions/drifts/${rule.id}/apply`, {}, child)).statusCode).toBe(403);

    const review = (await get(app, "/review/weekly", a)).json();
    expect(review.subscriptions).toEqual({ candidates: 1, increases: [{ label: "Canal", fromCents: -2499, toCents: -2799, percent: 12 }] });

    await post(app, `/subscriptions/drifts/${rule.id}/apply`, {}, a);
    const log = JSON.stringify((await admin.auditLog.findMany()).map((l) => l.action));
    expect(log).toContain("subscription.price_updated");
    expect(log).not.toMatch(/Canal|NETFLIX|2799/);
  });
});
