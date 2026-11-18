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
const OWNER_PASSWORD = owner(1).password;

async function household() {
  const o = sessionCookies(await post(app, "/auth/register", owner(1))).access!;
  await post(app, "/household/members", adult, { access: o });
  await post(app, "/household/members", child, { access: o });
  const a = sessionCookies(await post(app, "/auth/login", { email: adult.email, password: adult.password })).access!;
  const c = sessionCookies(await post(app, "/auth/login", { email: child.email, password: child.password })).access!;
  const householdId = (await admin.user.findUniqueOrThrow({ where: { email: owner(1).email } })).householdId;
  return { o, a, c, householdId };
}

const account = async (access: string, name: string, extra: object = {}) =>
  (await post(app, "/accounts", { name, type: "CHECKING", initialBalanceCents: 10_000, ...extra }, { access })).json() as { id: string };

describe("export des données (portabilité)", () => {
  it("exige le mot de passe et renvoie toutes les données visibles, IBAN en clair, sans aucun secret", async () => {
    const { o, a } = await household();
    const joint = await account(o, "Joint", { iban: "FR76 3000 6000 0112 3456 7890 189" });
    const perso = await account(a, "Perso Sam", { personal: true });
    await post(app, "/transactions", { accountId: joint.id, amountCents: -4_200, date: "2026-11-10", label: "Courses" }, { access: o });
    await post(app, "/transactions", { accountId: perso.id, amountCents: -1_000, date: "2026-11-11", label: "Cadeau secret" }, { access: a });
    await post(app, "/categories", { name: "Alimentation", monthlyBudgetCents: 40_000 }, { access: o });

    expect((await post(app, "/privacy/export", { password: "mauvais-mot-de-passe" }, { access: o })).statusCode).toBe(400);
    expect((await post(app, "/privacy/export", {}, { access: o })).statusCode).toBe(400);
    const res = await post(app, "/privacy/export", { password: OWNER_PASSWORD }, { access: o });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const data = res.json();
    expect(data).toMatchObject({ format: 1, household: { name: "Foyer 1" }, me: { email: owner(1).email, role: "OWNER" } });
    expect(data.members).toHaveLength(3);
    expect(data.accounts).toEqual([expect.objectContaining({ name: "Joint", iban: "FR7630006000011234567890189", personal: false })]);
    expect(data.transactions).toEqual([expect.objectContaining({ label: "Courses", amountCents: -4_200, date: "2026-11-10" })]);
    expect(data.categories[0]).toMatchObject({ name: "Alimentation", monthlyBudgetCents: 40_000 });
    expect(data.auditLog.some((e: { action: string }) => e.action === "account.created")).toBe(true);

    const text = res.body;
    expect(text).not.toContain("Cadeau secret"); // compte personnel d'un autre membre
    expect(text).not.toContain(OWNER_PASSWORD);
    for (const secret of ["passwordHash", "totpSecret", "tokenHash", "endpoint", "p256dh", "ibanEncrypted", "$argon2"]) expect(text).not.toContain(secret);
  });

  it("un membre exporte ses comptes personnels, sans le journal réservé au propriétaire", async () => {
    const { a } = await household();
    const perso = await account(a, "Perso Sam", { personal: true });
    await post(app, "/transactions", { accountId: perso.id, amountCents: -1_000, date: "2026-11-11", label: "Cadeau secret" }, { access: a });
    const data = (await post(app, "/privacy/export", { password: adult.password }, { access: a })).json();
    expect(data.accounts).toEqual([expect.objectContaining({ name: "Perso Sam", personal: true })]);
    expect(data.transactions[0].label).toBe("Cadeau secret");
    expect(data).not.toHaveProperty("auditLog");
  });

  it("un mauvais mot de passe compte comme un échec de connexion et finit par verrouiller", async () => {
    const { o } = await household();
    for (let i = 0; i < 5; i++) await post(app, "/privacy/export", { password: "mauvais-mot-de-passe" }, { access: o });
    const locked = await post(app, "/privacy/export", { password: OWNER_PASSWORD }, { access: o });
    expect(locked.statusCode).toBe(403);
    const actions = (await admin.auditLog.findMany({ select: { action: true } })).map((e) => e.action);
    expect(actions).toContain("auth.locked");
  });
});

describe("effacement des données", () => {
  it("un membre supprime son compte : ses comptes personnels partent, ses saisies sur les comptes joints restent", async () => {
    const { o, a } = await household();
    const joint = await account(o, "Joint");
    const perso = await account(a, "Perso Sam", { personal: true });
    await post(app, "/transactions", { accountId: joint.id, amountCents: -3_000, date: "2026-11-10", label: "Saisie de Sam" }, { access: a });
    await post(app, "/transactions", { accountId: perso.id, amountCents: -1_000, date: "2026-11-11", label: "Cadeau secret" }, { access: a });

    expect((await post(app, "/privacy/delete-me", { password: adult.password }, { access: a })).statusCode).toBe(400);
    expect((await post(app, "/privacy/delete-me", { password: adult.password, confirm: "supprimer" }, { access: a })).statusCode).toBe(400);
    expect((await post(app, "/privacy/delete-me", { password: "mauvais-mot-de-passe", confirm: "SUPPRIMER" }, { access: a })).statusCode).toBe(400);
    const res = await post(app, "/privacy/delete-me", { password: adult.password, confirm: "SUPPRIMER" }, { access: a });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === "access")?.value).toBe("");

    expect(await admin.user.count({ where: { email: adult.email } })).toBe(0);
    expect(await admin.bankAccount.count({ where: { id: perso.id } })).toBe(0);
    expect(await admin.transaction.count({ where: { label: "Cadeau secret" } })).toBe(0);
    expect(await admin.transaction.count({ where: { label: "Saisie de Sam" } })).toBe(1);
    // Le jeton encore valide ne donne plus accès à rien.
    expect((await get(app, "/accounts", { access: a })).statusCode).toBe(401);
    expect((await post(app, "/auth/login", { email: adult.email, password: adult.password })).statusCode).toBe(401);
    const actions = ((await get(app, "/household/audit", { access: o })).json().entries as { action: string }[]).map((e) => e.action);
    expect(actions).toContain("privacy.member_deleted_self:ADULT");
  });

  it("le propriétaire ne supprime pas seulement son compte", async () => {
    const { o } = await household();
    expect((await post(app, "/privacy/delete-me", { password: OWNER_PASSWORD, confirm: "SUPPRIMER" }, { access: o })).statusCode).toBe(409);
  });

  it("le propriétaire retire un membre, comptes personnels compris ; un adulte ne peut pas", async () => {
    const { o, a, c } = await household();
    const perso = await account(a, "Perso Sam", { personal: true });
    const members = (await get(app, "/household/members", { access: o })).json() as { id: string; email: string }[];
    const sam = members.find((m) => m.email === adult.email)!;
    const lea = members.find((m) => m.email === child.email)!;
    const me = members.find((m) => m.email === owner(1).email)!;

    expect((await post(app, `/household/members/${lea.id}/remove`, { password: adult.password }, { access: a })).statusCode).toBe(403);
    expect((await post(app, `/household/members/${me.id}/remove`, { password: OWNER_PASSWORD }, { access: o })).statusCode).toBe(400);
    expect((await post(app, `/household/members/${sam.id}/remove`, { password: "mauvais-mot-de-passe" }, { access: o })).statusCode).toBe(400);
    expect((await post(app, `/household/members/${sam.id}/remove`, { password: OWNER_PASSWORD }, { access: o })).statusCode).toBe(204);
    expect(await admin.user.count({ where: { id: sam.id } })).toBe(0);
    expect(await admin.bankAccount.count({ where: { id: perso.id } })).toBe(0);
    expect((await get(app, "/accounts", { access: a })).statusCode).toBe(401);
    expect((await get(app, "/accounts", { access: c })).statusCode).toBe(200);
    expect((await post(app, `/household/members/${sam.id}/remove`, { password: OWNER_PASSWORD }, { access: o })).statusCode).toBe(404);
  });

  it("IDOR : un propriétaire ne retire pas le membre d'un autre foyer", async () => {
    await household();
    const other = sessionCookies(await post(app, "/auth/register", owner(2))).access!;
    const sam = await admin.user.findUniqueOrThrow({ where: { email: adult.email } });
    expect((await post(app, `/household/members/${sam.id}/remove`, { password: owner(2).password }, { access: other })).statusCode).toBe(404);
    expect(await admin.user.count({ where: { id: sam.id } })).toBe(1);
  });

  it("le propriétaire supprime le foyer entier ; les autres foyers ne sont pas touchés", async () => {
    const { o, a, householdId } = await household();
    const joint = await account(o, "Joint");
    await account(a, "Perso Sam", { personal: true });
    await post(app, "/transactions", { accountId: joint.id, amountCents: -3_000, date: "2026-11-10", label: "Courses" }, { access: o });
    const other = sessionCookies(await post(app, "/auth/register", owner(2))).access!;
    await account(other, "Autre foyer");

    expect((await post(app, "/privacy/delete-household", { password: adult.password, confirm: "SUPPRIMER" }, { access: a })).statusCode).toBe(403);
    expect((await post(app, "/privacy/delete-household", { password: OWNER_PASSWORD }, { access: o })).statusCode).toBe(400);
    const res = await post(app, "/privacy/delete-household", { password: OWNER_PASSWORD, confirm: "SUPPRIMER" }, { access: o });
    expect(res.statusCode).toBe(204);

    expect(await admin.household.count({ where: { id: householdId } })).toBe(0);
    for (const count of [
      admin.user.count({ where: { householdId } }), admin.bankAccount.count({ where: { householdId } }),
      admin.transaction.count({ where: { householdId } }), admin.auditLog.count({ where: { householdId } }),
    ]) expect(await count).toBe(0);
    expect((await get(app, "/accounts", { access: o })).statusCode).toBe(401);
    expect(((await get(app, "/accounts", { access: other })).json() as { name: string }[]).map((x) => x.name)).toEqual(["Autre foyer"]);
  });
});
