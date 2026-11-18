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
const patch = (url: string, payload: object, cookies: Cookies) => app.inject({ method: "PATCH", url, payload, cookies });
const del = (url: string, cookies: Cookies) => app.inject({ method: "DELETE", url, cookies });
const month = () => new Date().toISOString().slice(0, 7);
const day = (d: number) => `${month()}-${String(d).padStart(2, "0")}`;
const newAccount = async (c: Cookies) => (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id as string;
const newCategory = async (c: Cookies, body: object) => (await post(app, "/categories", body, c)).json().id as string;
const overview = async (c: Cookies, query = "") => (await get(app, `/categories${query}`, c)).json();
const spend = (c: Cookies, accountId: string, amountCents: number, categoryId: string | null, date = day(1)) =>
  post(app, "/transactions", { accountId, amountCents, date, label: "Dépense", categoryId }, c);

describe("catégories et budgets", () => {
  it("exige une session et commence vide", async () => {
    expect((await get(app, "/categories")).statusCode).toBe(401);
    const c = await register();
    expect(await overview(c)).toEqual({ month: month(), scope: "all", categories: [], uncategorizedSpentCents: 0, totals: { availableCents: 0, spentCents: 0 } });
  });

  it("valide les catégories : nom obligatoire et unique dans le foyer, plafond positif, mois au bon format", async () => {
    const c = await register();
    expect((await post(app, "/categories", { name: " " }, c)).statusCode).toBe(400);
    expect((await post(app, "/categories", { name: "Courses", monthlyBudgetCents: 0 }, c)).statusCode).toBe(400);
    expect((await post(app, "/categories", { name: "Courses", monthlyBudgetCents: 40_000 }, c)).statusCode).toBe(201);
    const dup = await post(app, "/categories", { name: "Courses" }, c);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().message).toBe("Une catégorie porte déjà ce nom");
    expect((await get(app, "/categories?month=2026-13", c)).statusCode).toBe(400);
    // Le même nom reste libre dans un autre foyer.
    expect((await post(app, "/categories", { name: "Courses" }, await register(2))).statusCode).toBe(201);
  });

  it("suit les dépenses par catégorie, récurrences comprises, et alerte à 80 % puis à 100 %", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const courses = await newCategory(c, { name: "Courses", monthlyBudgetCents: 40_000 });
    const loisirs = await newCategory(c, { name: "Loisirs" });
    await spend(c, acc, -20_000, courses);
    await spend(c, acc, 5_000, courses); // remboursement
    await spend(c, acc, -3_000, null);
    await post(app, "/recurring-rules", { accountId: acc, label: "Streaming", amountCents: -1_500, frequency: "MONTHLY", start: day(1), categoryId: loisirs }, c);

    const data = await overview(c);
    expect(data.categories.map((x: { name: string }) => x.name)).toEqual(["Courses", "Loisirs"]);
    expect(data.categories[0]).toMatchObject({ spentCents: 15_000, budget: { limitCents: 40_000, spentCents: 15_000, remainingCents: 25_000, percent: 38, status: "OK" } });
    expect(data.categories[1]).toMatchObject({ spentCents: 1_500, budget: null });
    expect(data.uncategorizedSpentCents).toBe(3_000);
    expect(data.totals).toEqual({ availableCents: 40_000, spentCents: 15_000 });

    await spend(c, acc, -17_000, courses);
    expect((await overview(c)).categories[0].budget).toMatchObject({ percent: 80, status: "WARNING" });
    await spend(c, acc, -10_000, courses);
    expect((await overview(c)).categories[0].budget).toMatchObject({ remainingCents: -2_000, status: "EXCEEDED" });
  });

  it("classe et reclasse une opération ou une récurrence, et refuse une catégorie d'un autre foyer", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const courses = await newCategory(c, { name: "Courses" });
    const other = await newCategory(await register(2), { name: "Autre" });
    expect((await spend(c, acc, -1_000, other)).statusCode).toBe(400);
    expect((await post(app, "/recurring-rules", { accountId: acc, label: "x", amountCents: -100, frequency: "MONTHLY", start: day(1), categoryId: other }, c)).statusCode).toBe(400);

    const tx = (await spend(c, acc, -1_000, null)).json();
    expect(tx.categoryId).toBeNull();
    expect((await patch(`/transactions/${tx.id}`, { categoryId: other }, c)).statusCode).toBe(400);
    expect((await patch(`/transactions/${tx.id}`, { categoryId: courses }, c)).statusCode).toBe(200);
    expect((await get(app, "/transactions", c)).json()[0].categoryId).toBe(courses);

    const rule = (await post(app, "/recurring-rules", { accountId: acc, label: "Abonnement", amountCents: -500, frequency: "MONTHLY", start: day(1) }, c)).json();
    expect((await patch(`/recurring-rules/${rule.id}`, { categoryId: courses }, c)).statusCode).toBe(200);
    expect((await get(app, "/recurring-rules", c)).json()[0].categoryId).toBe(courses);
    expect((await patch(`/recurring-rules/${rule.id}`, { categoryId: null }, c)).statusCode).toBe(200);
    expect((await get(app, "/recurring-rules", c)).json()[0].categoryId).toBeNull();
  });

  it("modifie un budget, reporte le reliquat à partir du mois du budget, et libère les opérations à la suppression", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const id = await newCategory(c, { name: "Courses" });
    await spend(c, acc, -1_000, id);
    expect((await put(`/categories/${id}`, { name: "Alimentation", monthlyBudgetCents: 10_000, rollover: true }, c)).statusCode).toBe(200);
    const [cat] = (await overview(c)).categories;
    expect(cat).toMatchObject({ name: "Alimentation", rollover: true, budget: { carryOverCents: 0, availableCents: 10_000, spentCents: 1_000 } });

    // Le budget ne vaut qu'à partir du mois où il est fixé : le mois précédent n'en a pas.
    const [y, m] = month().split("-").map(Number) as [number, number];
    const previous = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    expect((await overview(c, `?month=${previous}`)).categories[0].budget).toBeNull();
    // Le mois suivant reçoit le reliquat (9 000) en plus de son plafond.
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    expect((await overview(c, `?month=${next}`)).categories[0].budget).toMatchObject({ carryOverCents: 9_000, availableCents: 19_000 });

    expect((await put(`/categories/${id}`, { name: "Alimentation", monthlyBudgetCents: null }, c)).statusCode).toBe(200);
    expect((await admin.category.findUniqueOrThrow({ where: { id } })).budgetSince).toBeNull();
    expect((await put("/categories/5b7c8a52-8b0f-4f43-9c1a-1c3b8f1d0a11", { name: "x" }, c)).statusCode).toBe(404);

    expect((await del(`/categories/${id}`, c)).statusCode).toBe(204);
    expect((await del(`/categories/${id}`, c)).statusCode).toBe(404);
    expect((await get(app, "/transactions", c)).json()[0].categoryId).toBeNull();
    expect((await overview(c)).uncategorizedSpentCents).toBe(1_000);
  });

  it("isole les foyers et interdit l'écriture à un enfant", async () => {
    const a = await register();
    const id = await newCategory(a, { name: "Courses", monthlyBudgetCents: 10_000 });
    const b = await register(2);
    expect((await overview(b)).categories).toEqual([]);
    expect((await put(`/categories/${id}`, { name: "Piratée" }, b)).statusCode).toBe(404);
    expect((await del(`/categories/${id}`, b)).statusCode).toBe(404);

    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, a);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    expect((await post(app, "/categories", { name: "Bonbons" }, child)).statusCode).toBe(403);
    expect((await put(`/categories/${id}`, { name: "x" }, child)).statusCode).toBe(403);
    expect((await del(`/categories/${id}`, child)).statusCode).toBe(403);
    expect((await overview(child)).categories).toHaveLength(1);
    const actions = (await admin.auditLog.findMany()).map((l) => l.action);
    expect(actions).toContain("category.created");
    expect(JSON.stringify(actions)).not.toContain("10000");
  });

  it("rappelle les écarts vs budget dans le bilan de la semaine", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const id = await newCategory(c, { name: "Courses", monthlyBudgetCents: 10_000 });
    await newCategory(c, { name: "Sans budget" });
    await spend(c, acc, -9_000, id, new Date().toISOString().slice(0, 10));
    const review = (await get(app, "/review/weekly", c)).json();
    expect(review.budgets).toEqual([{ id, name: "Courses", status: "WARNING", percent: 90, remainingCents: 1_000 }]);
  });
});
