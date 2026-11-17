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
const patch = (url: string, payload: object, cookies: Cookies) => app.inject({ method: "PATCH", url, payload, cookies });
const del = (url: string, cookies: Cookies) => app.inject({ method: "DELETE", url, cookies });
const newAccount = async (c: Cookies) => (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id as string;
const newCategory = async (c: Cookies, name: string) => (await post(app, "/categories", { name }, c)).json().id as string;
const tx = (c: Cookies, accountId: string, label: string, extra: object = {}) =>
  post(app, "/transactions", { accountId, amountCents: -1_000, date: "2026-11-03", label, ...extra }, c);
const rules = async (c: Cookies) => (await get(app, "/categories/rules", c)).json();

function upload(c: Cookies, accountId: string, csv: string) {
  const boundary = "----testboundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="r.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({ method: "POST", url: `/imports/preview?accountId=${accountId}`, payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, cookies: c });
}

describe("catégorisation automatique", () => {
  it("apprend d'un classement, l'applique aux opérations suivantes, et suit la dernière correction", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const courses = await newCategory(c, "Courses");
    const maison = await newCategory(c, "Maison");

    // Sans règle ni historique : aucune catégorie.
    expect((await tx(c, acc, "CB CARREFOUR EVRY")).json().categoryId).toBeNull();
    // Un choix explicite crée la règle « carrefour → Courses »…
    await tx(c, acc, "CB CARREFOUR MASSY 12/11", { categoryId: courses });
    expect(await rules(c)).toEqual([expect.objectContaining({ pattern: "carrefour", categoryId: courses, category: "Courses", source: "LEARNED", hits: 1 })]);
    // … appliquée automatiquement ensuite (categoryId absent) ; null force « sans catégorie ».
    expect((await tx(c, acc, "CB CARREFOUR CITY")).json().categoryId).toBe(courses);
    expect((await tx(c, acc, "CB CARREFOUR CITY", { categoryId: null })).json().categoryId).toBeNull();

    // Reclasser est une correction : la règle apprise suit.
    const first = (await get(app, "/transactions", c)).json().find((t: { label: string }) => t.label === "CB CARREFOUR EVRY");
    expect((await patch(`/transactions/${first.id}`, { categoryId: maison }, c)).statusCode).toBe(200);
    expect((await rules(c))[0]).toMatchObject({ pattern: "carrefour", categoryId: maison, hits: 1 });
    // Retirer la catégorie n'apprend rien.
    expect((await patch(`/transactions/${first.id}`, { categoryId: null }, c)).statusCode).toBe(200);
    expect((await rules(c))[0]).toMatchObject({ categoryId: maison });
  });

  it("donne priorité à une règle saisie, qu'un classement n'écrase jamais, et gère les règles", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const telecom = await newCategory(c, "Télécom");
    const loisirs = await newCategory(c, "Loisirs");
    expect((await post(app, "/categories/rules", { pattern: "x", categoryId: telecom }, c)).statusCode).toBe(400);
    expect((await post(app, "/categories/rules", { pattern: "--", categoryId: telecom }, c)).statusCode).toBe(400);
    const other = await newCategory(await register(2), "Autre");
    expect((await post(app, "/categories/rules", { pattern: "free", categoryId: other }, c)).statusCode).toBe(400);

    const saved = await post(app, "/categories/rules", { pattern: "  Free Mobile ", categoryId: telecom }, c);
    expect(saved.statusCode).toBe(201);
    expect(saved.json().pattern).toBe("free mobile");
    expect((await tx(c, acc, "PRLV SEPA FREE MOBILE")).json().categoryId).toBe(telecom);

    // Le libellé « PRLV FREE MOBILE » donne le mot-clé appris « free » : règle distincte, la règle saisie reste prioritaire.
    await tx(c, acc, "PRLV FREE MOBILE", { categoryId: loisirs });
    expect((await tx(c, acc, "PRLV FREE MOBILE")).json().categoryId).toBe(telecom);
    // Une règle saisie sur un mot-clé appris le remplace, et n'est plus modifiée par les classements.
    await post(app, "/categories/rules", { pattern: "free", categoryId: telecom }, c);
    await tx(c, acc, "PRLV FREE BOX", { categoryId: loisirs });
    const list = await rules(c);
    expect(list.map((r: { pattern: string; source: string; categoryId: string }) => [r.pattern, r.source, r.categoryId])).toEqual([
      ["free", "MANUAL", telecom], ["free mobile", "MANUAL", telecom],
    ]);

    expect((await del(`/categories/rules/${list[0].id}`, c)).statusCode).toBe(204);
    expect((await del(`/categories/rules/${list[0].id}`, c)).statusCode).toBe(404);
    // Supprimer la catégorie supprime ses règles.
    await del(`/categories/${telecom}`, c);
    expect(await rules(c)).toEqual([]);
  });

  it("classe d'un coup les opérations sans catégorie, avec les règles puis le classifieur", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const courses = await newCategory(c, "Courses");
    const loisirs = await newCategory(c, "Loisirs");
    for (const label of ["CB LECLERC DRIVE", "CB AUCHAN", "CB LIDL"]) await tx(c, acc, label, { categoryId: courses });
    for (const label of ["CB PATHE", "CB BOWLING"]) await tx(c, acc, label, { categoryId: loisirs });
    // Opérations sans catégorie à rattraper : règle apprise (« leclerc »), classifieur (« drive » vu avec Courses), inconnue.
    for (const label of ["LECLERC STATION", "DRIVE PIETON", "CB INCONNU"]) await tx(c, acc, label, { categoryId: null });

    const res = await post(app, "/categories/auto", {}, c);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ categorized: 2 });
    const byLabel = Object.fromEntries((await get(app, "/transactions", c)).json().map((t: { label: string; categoryId: string | null }) => [t.label, t.categoryId]));
    expect(byLabel).toMatchObject({ "LECLERC STATION": courses, "DRIVE PIETON": courses, "CB INCONNU": null });
    expect((await post(app, "/categories/auto", {}, c)).json()).toEqual({ categorized: 0 });
  });

  it("propose une catégorie à l'import, l'applique, et apprend le choix fait dans l'aperçu", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const courses = await newCategory(c, "Courses");
    const sante = await newCategory(c, "Santé");
    await post(app, "/categories/rules", { pattern: "carrefour", categoryId: courses }, c);
    const csv = "Date;Libellé;Montant\n03/11/2026;CB CARREFOUR EVRY;-45,30\n04/11/2026;CB PHARMACIE CENTRALE;-12,00\n05/11/2026;CB INCONNU;-1,00\n";
    const lines = (await upload(c, acc, csv)).json().lines;
    expect(lines.map((l: { suggestion?: { categoryId: string; source: string } }) => l.suggestion ?? null)).toEqual([{ categoryId: courses, source: "RULE" }, null, null]);

    const send = lines.map((l: { key: string; date: string; amountCents: number; label: string }, i: number) => ({
      key: l.key, date: l.date, amountCents: l.amountCents, label: l.label, action: "CREATE",
      ...(i === 1 ? { categoryId: sante } : i === 2 ? { categoryId: null } : {}),
    }));
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: send }, c)).json()).toMatchObject({ created: 3 });
    const rows = await admin.transaction.findMany({ orderBy: { date: "asc" } });
    expect(rows.map((r) => r.categoryId)).toEqual([courses, sante, null]);
    expect((await rules(c)).map((r: { pattern: string }) => r.pattern)).toContain("pharmacie");

    const foreign = await newCategory(await register(2), "Autre");
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [{ ...send[2], key: "f".repeat(64), categoryId: foreign }] }, c)).statusCode).toBe(400);
  });

  it("isole les règles par foyer, interdit l'écriture à un enfant et journalise sans mot-clé", async () => {
    const a = await register();
    const cat = await newCategory(a, "Courses");
    const rule = (await post(app, "/categories/rules", { pattern: "carrefour", categoryId: cat }, a)).json();
    const b = await register(2);
    expect(await rules(b)).toEqual([]);
    expect((await del(`/categories/rules/${rule.id}`, b)).statusCode).toBe(404);
    expect((await post(app, "/categories/auto", {}, b)).json()).toEqual({ categorized: 0 });

    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, a);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    expect((await post(app, "/categories/rules", { pattern: "lidl", categoryId: cat }, child)).statusCode).toBe(403);
    expect((await del(`/categories/rules/${rule.id}`, child)).statusCode).toBe(403);
    expect((await post(app, "/categories/auto", {}, child)).statusCode).toBe(403);
    expect(await rules(child)).toHaveLength(1);
    const log = JSON.stringify((await admin.auditLog.findMany()).map((l) => l.action));
    expect(log).toContain("category.rule_saved");
    expect(log).not.toContain("carrefour");
  });
});
