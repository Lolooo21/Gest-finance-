import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { admin, get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const adult = { email: "adulte@example.com", password: "cheval-agrafe-batterie", displayName: "Sam", role: "ADULT" };
const child = { email: "enfant@example.com", password: "agrafe-cheval-batterie", displayName: "Léa", role: "CHILD" };

const patch = (url: string, payload: unknown, access: string) => app.inject({ method: "PATCH", url, payload: payload as object, cookies: { access } });
const del = (url: string, access: string) => app.inject({ method: "DELETE", url, cookies: { access } });

/** Foyer avec un propriétaire, un adulte et un enfant ; renvoie les jetons d'accès. */
async function household() {
  const o = sessionCookies(await post(app, "/auth/register", owner(1))).access!;
  await post(app, "/household/members", adult, { access: o });
  await post(app, "/household/members", child, { access: o });
  const a = sessionCookies(await post(app, "/auth/login", { email: adult.email, password: adult.password })).access!;
  const c = sessionCookies(await post(app, "/auth/login", { email: child.email, password: child.password })).access!;
  return { o, a, c };
}

const account = async (access: string, name: string, personal?: boolean) =>
  (await post(app, "/accounts", { name, type: "CHECKING", initialBalanceCents: 10_000, ...(personal === undefined ? {} : { personal }) }, { access })).json() as { id: string; personal: boolean };

const names = async (access: string) => ((await get(app, "/accounts", access ? { access } : undefined)).json() as { name: string }[]).map((x) => x.name).sort();

describe("comptes personnels et joints", () => {
  it("un compte personnel n'est visible que par son titulaire ; un compte joint par tout le foyer", async () => {
    const { o, a, c } = await household();
    expect((await account(o, "Joint")).personal).toBe(false);
    expect((await account(a, "Perso Sam", true)).personal).toBe(true);
    await account(o, "Perso propriétaire", true);

    expect(await names(a)).toEqual(["Joint", "Perso Sam"]);
    expect(await names(o)).toEqual(["Joint", "Perso propriétaire"]);
    expect(await names(c)).toEqual(["Joint"]);
    const listed = (await get(app, "/accounts", { access: a })).json() as { name: string; personal: boolean }[];
    expect(listed.find((x) => x.name === "Perso Sam")?.personal).toBe(true);
  });

  it("les opérations et récurrences d'un compte personnel restent invisibles et inaccessibles aux autres membres", async () => {
    const { o, a } = await household();
    const perso = await account(a, "Perso Sam", true);
    const tx = (await post(app, "/transactions", { accountId: perso.id, amountCents: -4_200, date: "2026-11-10", label: "Cadeau secret" }, { access: a })).json() as { id: string };
    await post(app, "/recurring-rules", { accountId: perso.id, label: "Salle de sport", amountCents: -3_000, frequency: "MONTHLY", start: "2026-11-01" }, { access: a });

    expect(JSON.stringify((await get(app, "/transactions", { access: o })).json())).not.toContain("Cadeau secret");
    expect(JSON.stringify((await get(app, "/recurring-rules", { access: o })).json())).not.toContain("Salle de sport");
    expect(JSON.stringify((await get(app, "/transactions", { access: a })).json())).toContain("Cadeau secret");

    // IDOR : le propriétaire du foyer ne peut ni écrire sur ce compte, ni modifier, ni supprimer ce qu'il contient.
    expect((await post(app, "/transactions", { accountId: perso.id, amountCents: -1, date: "2026-11-10", label: "intrus" }, { access: o })).statusCode).toBe(404);
    expect((await patch(`/accounts/${perso.id}`, { name: "piraté" }, o)).statusCode).toBe(404);
    expect((await patch(`/transactions/${tx.id}`, { label: "piraté" }, o)).statusCode).toBe(404);
    expect((await del(`/transactions/${tx.id}`, o)).statusCode).toBe(404);
    expect((await del(`/accounts/${perso.id}`, o)).statusCode).toBe(404);
    expect(await admin.transaction.count({ where: { id: tx.id, label: "Cadeau secret" } })).toBe(1);
  });

  it("le reste à vivre se filtre par vue : tout, joint ou mes comptes personnels", async () => {
    const { o, a } = await household();
    const joint = await account(o, "Joint");
    const perso = await account(a, "Perso Sam", true);
    await post(app, "/transactions", { accountId: joint.id, amountCents: -10_000, date: "2026-11-05", label: "Courses" }, { access: a });
    await post(app, "/transactions", { accountId: perso.id, amountCents: -2_500, date: "2026-11-06", label: "Livre" }, { access: a });
    const summary = async (access: string, scope?: string) =>
      (await get(app, `/summary?from=2026-11-01&to=2026-11-30${scope ? `&scope=${scope}` : ""}`, { access })).json() as { oneOffExpensesCents: number; scope: string };

    expect((await summary(a)).oneOffExpensesCents).toBe(12_500);
    expect((await summary(a, "joint")).oneOffExpensesCents).toBe(10_000);
    expect((await summary(a, "personal")).oneOffExpensesCents).toBe(2_500);
    // Le propriétaire du foyer ne voit pas la dépense personnelle de Sam, quelle que soit la vue.
    expect((await summary(o)).oneOffExpensesCents).toBe(10_000);
    expect((await summary(o, "personal")).oneOffExpensesCents).toBe(0);
    expect((await get(app, "/summary?from=2026-11-01&to=2026-11-30&scope=autre", { access: o })).statusCode).toBe(400);
  });

  it("partager et rendre personnel : le titulaire partage, seul le propriétaire du foyer peut retirer un compte joint au foyer", async () => {
    const { o, a, c } = await household();
    const perso = await account(a, "Perso Sam", true);
    expect((await patch(`/accounts/${perso.id}`, { personal: false }, a)).statusCode).toBe(200);
    expect(await names(o)).toContain("Perso Sam");

    const joint = await account(o, "Joint");
    const denied = await patch(`/accounts/${joint.id}`, { personal: true }, a);
    expect(denied.statusCode).toBe(403);
    expect(await names(a)).toContain("Joint");
    expect((await patch(`/accounts/${joint.id}`, { personal: true }, c)).statusCode).toBe(403);
    expect((await patch(`/accounts/${joint.id}`, { personal: true }, o)).statusCode).toBe(200);
    expect(await names(a)).not.toContain("Joint");

    const actions = ((await get(app, "/household/audit", { access: o })).json().entries as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["account.created:personal", "account.shared", "account.made_personal"]));
  });

  it("un enfant ne crée pas de compte, même personnel", async () => {
    const { c } = await household();
    expect((await post(app, "/accounts", { name: "Tirelire", type: "SAVINGS", initialBalanceCents: 0, personal: true }, { access: c })).statusCode).toBe(403);
  });
});
