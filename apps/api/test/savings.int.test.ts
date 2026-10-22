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
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const overview = async (c: Cookies) => (await get(app, "/goals/savings", c)).json();
const goalBody = (over: object = {}) => ({ name: "Vacances", kind: "SHORT_TERM", targetCents: 120_000, targetDate: inDays(365), ...over });
const newGoal = async (c: Cookies, over: object = {}) => (await post(app, "/goals/savings", goalBody(over), c)).json().id as string;
const contribute = (c: Cookies, id: string, amountCents: number, date = today()) => post(app, `/goals/savings/${id}/contributions`, { amountCents, date }, c);

describe("objectifs d'épargne", () => {
  it("exige une session et commence vide", async () => {
    expect((await get(app, "/goals/savings")).statusCode).toBe(401);
    const c = await register();
    expect(await overview(c)).toMatchObject({
      goals: [], capacityCents: 0, totalAdvisedCents: 0,
      emergency: { averageMonthlyExpensesCents: 0, threeMonthsCents: 0, sixMonthsCents: 0, savedCents: 0, coverageTenths: null, belowThreeMonths: false },
    });
  });

  it("valide les objectifs : cible positive, échéance obligatoire hors épargne de secours, compte du foyer", async () => {
    const c = await register();
    expect((await post(app, "/goals/savings", goalBody({ targetDate: null }), c)).statusCode).toBe(400);
    expect((await post(app, "/goals/savings", goalBody({ targetCents: 0 }), c)).statusCode).toBe(400);
    expect((await post(app, "/goals/savings", goalBody({ name: " " }), c)).statusCode).toBe(400);
    expect((await post(app, "/goals/savings", goalBody({ kind: "AUTRE" }), c)).statusCode).toBe(400);
    expect((await post(app, "/goals/savings", goalBody({ annualRateBp: 5000 }), c)).statusCode).toBe(400);
    expect((await post(app, "/goals/savings", goalBody({ accountId: "5b7c8a52-8b0f-4f43-9c1a-1c3b8f1d0a11" }), c)).statusCode).toBe(400);
    expect((await post(app, "/goals/savings", goalBody({ kind: "EMERGENCY", name: "Secours", targetDate: null }), c)).statusCode).toBe(201);
  });

  it("suit l'avancement par les versements, conseille un versement mensuel et refuse un retrait trop grand", async () => {
    const c = await register();
    const id = await newGoal(c);
    expect((await contribute(c, id, 50_000)).statusCode).toBe(201);
    expect((await contribute(c, id, 20_000, inDays(-1))).statusCode).toBe(201);
    expect((await contribute(c, id, 0)).statusCode).toBe(400);
    expect((await contribute(c, id, -80_000)).statusCode).toBe(400);
    expect((await contribute(c, id, -10_000)).statusCode).toBe(201);

    const [goal] = (await overview(c)).goals;
    expect(goal).toMatchObject({ name: "Vacances", kind: "SHORT_TERM", savedCents: 60_000, percent: 50, remainingCents: 60_000, status: "ON_TRACK" });
    expect(goal.monthsLeft).toBeGreaterThanOrEqual(12);
    expect(goal.advisedMonthlyCents).toBeGreaterThanOrEqual(4_000);
    expect(goal.advisedMonthlyCents).toBeLessThanOrEqual(5_000);
    expect(goal.contributions.map((x: { amountCents: number }) => x.amountCents)).toEqual([-10_000, 50_000, 20_000]);
    expect((await overview(c)).totalAdvisedCents).toBe(goal.advisedMonthlyCents);

    expect((await contribute(c, id, 60_000)).statusCode).toBe(201);
    expect((await overview(c)).goals[0]).toMatchObject({ status: "ACHIEVED", percent: 100, advisedMonthlyCents: 0 });
    expect((await overview(c)).totalAdvisedCents).toBe(0);
  });

  it("supprime un versement sauf s'il rendrait l'épargne négative", async () => {
    const c = await register();
    const id = await newGoal(c);
    const deposit = (await contribute(c, id, 50_000)).json().id;
    await contribute(c, id, -30_000);
    expect((await del(`/goals/savings/${id}/contributions/${deposit}`, c)).statusCode).toBe(400);
    const withdrawal = (await overview(c)).goals[0].contributions.find((x: { amountCents: number }) => x.amountCents < 0).id;
    expect((await del(`/goals/savings/${id}/contributions/${withdrawal}`, c)).statusCode).toBe(204);
    expect((await del(`/goals/savings/${id}/contributions/${deposit}`, c)).statusCode).toBe(204);
    expect((await del(`/goals/savings/${id}/contributions/${deposit}`, c)).statusCode).toBe(404);
  });

  it("modifie et supprime un objectif ; le compte lié est conservé à titre indicatif et libéré à sa suppression", async () => {
    const c = await register();
    const livret = (await post(app, "/accounts", { name: "Livret A", type: "SAVINGS", initialBalanceCents: 0 }, c)).json().id;
    const id = await newGoal(c, { accountId: livret });
    expect((await overview(c)).goals[0]).toMatchObject({ accountId: livret, account: "Livret A" });
    expect((await put(`/goals/savings/${id}`, goalBody({ name: "Voyage", targetCents: 200_000, accountId: livret }), c)).statusCode).toBe(200);
    expect((await overview(c)).goals[0]).toMatchObject({ name: "Voyage", targetCents: 200_000 });

    expect((await del(`/accounts/${livret}`, c)).statusCode).toBe(204);
    expect((await overview(c)).goals[0]).toMatchObject({ accountId: null, account: null });

    await contribute(c, id, 10_000);
    expect((await del(`/goals/savings/${id}`, c)).statusCode).toBe(204);
    expect((await del(`/goals/savings/${id}`, c)).statusCode).toBe(404);
    expect(await admin.savingsContribution.count()).toBe(0);
  });

  it("calcule l'épargne de secours d'après les dépenses habituelles et alerte sous 3 mois", async () => {
    const c = await register();
    const courant = (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id;
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - 5);
    await post(app, "/recurring-rules", { accountId: courant, label: "Loyer", amountCents: -100_000, frequency: "MONTHLY", start: start.toISOString().slice(0, 10) }, c);
    const secours = await newGoal(c, { kind: "EMERGENCY", name: "Secours", targetCents: 600_000, targetDate: null });
    await contribute(c, secours, 150_000);

    const { emergency, goals } = await overview(c);
    expect(emergency).toMatchObject({ averageMonthlyExpensesCents: 100_000, threeMonthsCents: 300_000, sixMonthsCents: 600_000, savedCents: 150_000, coverageTenths: 15, belowThreeMonths: true });
    expect(goals[0]).toMatchObject({ status: "NO_DATE", advisedMonthlyCents: null });
    await contribute(c, secours, 200_000);
    expect((await overview(c)).emergency).toMatchObject({ coverageTenths: 35, belowThreeMonths: false });
  });

  it("interdit l'écriture à un enfant mais autorise la lecture, et journalise sans montant", async () => {
    const a = await register();
    const id = await newGoal(a);
    await contribute(a, id, 123_456);
    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, a);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    expect((await get(app, "/goals/savings", child)).statusCode).toBe(200);
    expect((await post(app, "/goals/savings", goalBody(), child)).statusCode).toBe(403);
    expect((await put(`/goals/savings/${id}`, goalBody(), child)).statusCode).toBe(403);
    expect((await del(`/goals/savings/${id}`, child)).statusCode).toBe(403);
    expect((await contribute(child, id, 100)).statusCode).toBe(403);
    const actions = JSON.stringify((await admin.auditLog.findMany()).map((l) => l.action));
    expect(actions).toContain("goal.savings_created:SHORT_TERM");
    expect(actions).not.toContain("123456");
  });

  it("est isolé par foyer (lecture, modification, versements, suppression)", async () => {
    const a = await register(1);
    const b = await register(2);
    const id = await newGoal(a);
    const contribution = (await contribute(a, id, 5_000)).json().id;
    expect((await overview(b)).goals).toEqual([]);
    expect((await put(`/goals/savings/${id}`, goalBody({ name: "Piraté" }), b)).statusCode).toBe(404);
    expect((await contribute(b, id, 1_000)).statusCode).toBe(404);
    expect((await del(`/goals/savings/${id}/contributions/${contribution}`, b)).statusCode).toBe(404);
    expect((await del(`/goals/savings/${id}`, b)).statusCode).toBe(404);
    expect((await overview(a)).goals[0]).toMatchObject({ name: "Vacances", savedCents: 5_000 });
  });
});

describe("bilan de la semaine : état des objectifs", () => {
  it("résume les objectifs de comportement et d'épargne, sans montant de versement", async () => {
    const c = await register();
    expect((await get(app, "/review/weekly", c)).json().goals).toEqual({ behavior: [], savings: [], emergencyBelowThreeMonths: false });
    await put("/goals/behavior/NO_OVERDRAFT", {}, c);
    const id = await newGoal(c);
    await contribute(c, id, 30_000);
    const { goals } = (await get(app, "/review/weekly", c)).json();
    expect(goals.behavior).toEqual([{ kind: "NO_OVERDRAFT", status: "ON_TRACK", streak: 0 }]);
    expect(goals.savings).toHaveLength(1);
    expect(goals.savings[0]).toMatchObject({ id, name: "Vacances", status: "ON_TRACK", percent: 25 });
    expect(goals.savings[0].advisedMonthlyCents).toBeGreaterThan(0);
  });
});
