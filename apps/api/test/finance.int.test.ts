import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const newAccount = async (c: { access: string }, extra: object = {}) =>
  (await post(app, "/accounts", { name: "Compte courant", type: "CHECKING", initialBalanceCents: 100_000, ...extra }, c)).json().id as string;

describe("comptes", () => {
  it("chiffre l'IBAN en base et ne renvoie qu'une version masquée", async () => {
    const c = await register();
    const res = await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 5000, iban: "fr76 3000 6000 0112 3456 7890 189" }, c);
    expect(res.statusCode).toBe(201);
    expect(JSON.stringify(res.json())).not.toContain("1234567890");
    const row = await app.get(PrismaService).bankAccount.findFirstOrThrow();
    expect(row.ibanEncrypted).not.toContain("FR76");
    const list = (await get(app, "/accounts", c)).json();
    expect(list[0].ibanMasked).toBe("FR76••••0189");
  });

  it("refuse un IBAN invalide et un montant initial non entier", async () => {
    const c = await register();
    expect((await post(app, "/accounts", { name: "x", type: "CHECKING", initialBalanceCents: 0, iban: "pas-un-iban" }, c)).statusCode).toBe(400);
    expect((await post(app, "/accounts", { name: "x", type: "CHECKING", initialBalanceCents: 10.5 }, c)).statusCode).toBe(400);
  });

  it("calcule le solde courant à partir des opérations", async () => {
    const c = await register();
    const accountId = await newAccount(c);
    await post(app, "/transactions", { accountId, amountCents: -2_500, date: "2026-10-05", label: "Courses" }, c);
    await post(app, "/transactions", { accountId, amountCents: 1_000, date: "2026-10-06", label: "Remboursement" }, c);
    expect((await get(app, "/accounts", c)).json()[0].balanceCents).toBe(98_500);
  });
});

describe("opérations", () => {
  it("refuse un compte d'un autre foyer (IDOR) et un montant nul", async () => {
    const a = await register(1);
    const b = await register(2);
    const accountOfB = await newAccount(b);
    const res = await post(app, "/transactions", { accountId: accountOfB, amountCents: -100, date: "2026-10-01", label: "Intrusion" }, a);
    expect(res.statusCode).toBe(404);
    const own = await newAccount(a);
    expect((await post(app, "/transactions", { accountId: own, amountCents: 0, date: "2026-10-01", label: "Zéro" }, a)).statusCode).toBe(400);
  });

  it("ne liste, ne supprime et ne résume jamais les données d'un autre foyer", async () => {
    const a = await register(1);
    const b = await register(2);
    const accountId = await newAccount(a);
    const t = (await post(app, "/transactions", { accountId, amountCents: -999, date: "2026-10-02", label: "Privé" }, a)).json();

    expect((await get(app, "/transactions", b)).json()).toEqual([]);
    expect((await get(app, "/accounts", b)).json()).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/transactions/${t.id}`, cookies: b })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/accounts/${accountId}`, cookies: b })).statusCode).toBe(404);
    const sum = (await get(app, "/summary?from=2026-10-01&to=2026-10-31", b)).json();
    expect(sum.remainingCents).toBe(0);
  });

  it("interdit l'écriture à un enfant mais autorise la lecture", async () => {
    const a = await register(1);
    const accountId = await newAccount(a);
    await post(app, "/household/members", { email: "kid@example.com", password: "mot-de-passe-enfant-1", displayName: "Kid", role: "CHILD" }, a);
    const kid = { access: sessionCookies(await post(app, "/auth/login", { email: "kid@example.com", password: "mot-de-passe-enfant-1" })).access! };
    expect((await post(app, "/transactions", { accountId, amountCents: -100, date: "2026-10-01", label: "x" }, kid)).statusCode).toBe(403);
    expect((await post(app, "/accounts", { name: "x", type: "CHECKING", initialBalanceCents: 0 }, kid)).statusCode).toBe(403);
    expect((await get(app, "/accounts", kid)).statusCode).toBe(200);
    expect((await get(app, "/summary?from=2026-10-01&to=2026-10-31", kid)).statusCode).toBe(200);
  });
});

describe("reste à vivre", () => {
  it("se recalcule après chaque nouvelle entrée ou sortie", async () => {
    const c = await register();
    const accountId = await newAccount(c);
    await post(app, "/recurring-rules", { accountId, label: "Salaire", amountCents: 250_000, frequency: "MONTHLY", start: "2026-01-28" }, c);
    await post(app, "/recurring-rules", { accountId, label: "Loyer", amountCents: -80_000, frequency: "MONTHLY", start: "2026-01-05" }, c);
    const q = "/summary?from=2026-10-01&to=2026-10-31";

    expect((await get(app, q, c)).json()).toMatchObject({ incomeCents: 250_000, fixedChargesCents: 80_000, remainingCents: 170_000 });
    await post(app, "/transactions", { accountId, amountCents: -4_500, date: "2026-10-10", label: "Courses" }, c);
    expect((await get(app, q, c)).json().remainingCents).toBe(165_500);
    await post(app, "/transactions", { accountId, amountCents: 20_000, date: "2026-10-12", label: "Prime" }, c);
    expect((await get(app, q, c)).json().remainingCents).toBe(185_500);
    await post(app, "/transactions", { accountId, amountCents: -1_000, date: "2026-11-02", label: "Hors période" }, c);
    expect((await get(app, q, c)).json().remainingCents).toBe(185_500);
  });

  it("valide les paramètres de période", async () => {
    const c = await register();
    expect((await get(app, "/summary?from=2026-10-31&to=2026-10-01", c)).statusCode).toBe(400);
    expect((await get(app, "/summary?from=oups&to=2026-10-01", c)).statusCode).toBe(400);
    expect((await get(app, "/summary?from=2026-10-01&to=2026-10-31")).statusCode).toBe(401);
  });

  it("refuse une règle dont la fin précède le début", async () => {
    const c = await register();
    const accountId = await newAccount(c);
    const res = await post(app, "/recurring-rules", { accountId, label: "x", amountCents: -1, frequency: "WEEKLY", start: "2026-05-01", end: "2026-04-01" }, c);
    expect(res.statusCode).toBe(400);
  });
});

describe("modification et solde avec récurrences", () => {
  const patch = (url: string, payload: object, cookies: { access: string }) => app.inject({ method: "PATCH", url, payload, cookies });

  it("modifie un compte, une opération et une règle ; le reste à vivre suit", async () => {
    const c = await register();
    const accountId = await newAccount(c);
    const t = (await post(app, "/transactions", { accountId, amountCents: -1_000, date: "2026-10-03", label: "Courses" }, c)).json();
    const rule = (await post(app, "/recurring-rules", { accountId, label: "Loyer", amountCents: -50_000, frequency: "MONTHLY", start: "2026-01-05" }, c)).json();
    const q = "/summary?from=2026-10-01&to=2026-10-31";
    expect((await get(app, q, c)).json().remainingCents).toBe(-51_000);

    expect((await patch(`/transactions/${t.id}`, { amountCents: -3_000, label: "Gros plein" }, c)).statusCode).toBe(200);
    expect((await patch(`/recurring-rules/${rule.id}`, { amountCents: -40_000 }, c)).statusCode).toBe(200);
    expect((await patch(`/accounts/${accountId}`, { name: "Principal" }, c)).statusCode).toBe(200);
    expect((await get(app, q, c)).json().remainingCents).toBe(-43_000);
    expect((await get(app, "/accounts", c)).json()[0].name).toBe("Principal");
    expect((await get(app, "/transactions", c)).json()[0].label).toBe("Gros plein");
  });

  it("refuse les modifications d'un autre foyer, vides ou invalides, et celles d'un enfant", async () => {
    const a = await register(1);
    const b = await register(2);
    const accountId = await newAccount(a);
    const t = (await post(app, "/transactions", { accountId, amountCents: -100, date: "2026-10-03", label: "x" }, a)).json();
    const rule = (await post(app, "/recurring-rules", { accountId, label: "R", amountCents: -100, frequency: "WEEKLY", start: "2026-05-01" }, a)).json();

    expect((await patch(`/transactions/${t.id}`, { label: "piraté" }, b)).statusCode).toBe(404);
    expect((await patch(`/accounts/${accountId}`, { name: "piraté" }, b)).statusCode).toBe(404);
    expect((await patch(`/recurring-rules/${rule.id}`, { label: "piraté" }, b)).statusCode).toBe(404);
    expect((await patch(`/transactions/${t.id}`, {}, a)).statusCode).toBe(400);
    expect((await patch(`/transactions/${t.id}`, { amountCents: 0 }, a)).statusCode).toBe(400);
    expect((await patch(`/recurring-rules/${rule.id}`, { end: "2026-01-01" }, a)).statusCode).toBe(400);
    expect((await patch(`/recurring-rules/${rule.id}`, { end: null }, a)).statusCode).toBe(200);

    await post(app, "/household/members", { email: "kid@example.com", password: "mot-de-passe-enfant-1", displayName: "Kid", role: "CHILD" }, a);
    const kid = { access: sessionCookies(await post(app, "/auth/login", { email: "kid@example.com", password: "mot-de-passe-enfant-1" })).access! };
    expect((await patch(`/transactions/${t.id}`, { label: "enfant" }, kid)).statusCode).toBe(403);
  });

  it("inclut dans le solde les occurrences récurrentes échues, pas les futures", async () => {
    const c = await register();
    const accountId = await newAccount(c, { initialBalanceCents: 0 });
    const year = new Date().getUTCFullYear();
    await post(app, "/recurring-rules", { accountId, label: "Passée", amountCents: 1_000, frequency: "YEARLY", start: `${year - 2}-01-01` }, c);
    await post(app, "/recurring-rules", { accountId, label: "Future", amountCents: 999_999, frequency: "YEARLY", start: `${year + 1}-01-01` }, c);
    // 2 ans passés + l'occurrence de l'année en cours (1er janvier déjà échu) = 3 occurrences
    expect((await get(app, "/accounts", c)).json()[0].balanceCents).toBe(3_000);
  });
});
