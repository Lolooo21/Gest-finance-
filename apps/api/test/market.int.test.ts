import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketService } from "../src/market/market.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
let market: MarketService;
let prisma: PrismaService;
beforeAll(async () => {
  app = await startApp();
  market = app.get(MarketService);
  prisma = app.get(PrismaService);
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app);
  await prisma.marketSnapshot.deleteMany();
});

const csv = (period: string, value: string) => `TIME_PERIOD,OBS_VALUE\n${period},${value}\n`;
const ok = (body: string) => new Response(body, { status: 200 });
const NOW = new Date("2026-10-20T08:00:00Z");

/** Fausse implémentation de fetch : répond selon l'hôte et l'URL demandée. */
const fakeFetch = (handler: (url: URL) => Response | Promise<Response>) => vi.fn(async (input: URL | string) => handler(new URL(String(input)))) as unknown as typeof fetch;
const good = () => fakeFetch((url) => ok(url.pathname.includes("DFR") ? csv("2026-09-10", "1.75") : url.pathname.includes("prc_hicp") ? csv("2026-09", "1.2") : csv("2026-09", "3.45")));

describe("MarketService.refresh", () => {
  it("enregistre les trois indicateurs en points de base, de façon idempotente", async () => {
    const report = await market.refresh(NOW, good());
    expect(report).toEqual({ ok: ["ECB_DEPOSIT_RATE", "FR_10Y_YIELD", "FR_INFLATION"], failed: [] });
    await market.refresh(NOW, good());
    const rows = await prisma.marketSnapshot.findMany({ orderBy: { key: "asc" } });
    expect(rows.map((r) => [r.key, r.valueBp, r.observedAt])).toEqual([
      ["ECB_DEPOSIT_RATE", 175, "2026-09-10"], ["FR_10Y_YIELD", 345, "2026-09"], ["FR_INFLATION", 120, "2026-09"],
    ]);
  });

  it("n'appelle que des hôtes publics autorisés, en https, sans suivre de redirection, avec un délai maximal", async () => {
    const good1 = good();
    const f = good1 as unknown as ReturnType<typeof vi.fn>;
    await market.refresh(NOW, good1);
    expect(f).toHaveBeenCalledTimes(3);
    for (const [url, init] of f.mock.calls as [URL, RequestInit][]) {
      expect(url.protocol).toBe("https:");
      expect(["data-api.ecb.europa.eu", "ec.europa.eu"]).toContain(url.hostname);
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init).not.toHaveProperty("credentials");
      expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization/i);
      expect((init.headers as Record<string, string>).Accept).toBe("*/*");
    }
  });

  it("continue quand une source échoue et garde la dernière valeur connue", async () => {
    await market.refresh(NOW, good());
    const flaky = fakeFetch((url) => {
      if (url.pathname.includes("DFR")) return new Response("boom", { status: 503 });
      if (url.pathname.includes("prc_hicp")) throw new TypeError("redirect mode is set to error");
      return ok(csv("2026-10", "3.60"));
    });
    const report = await market.refresh(new Date("2026-10-21T08:00:00Z"), flaky);
    expect(report.ok).toEqual(["FR_10Y_YIELD"]);
    expect(report.failed.map((f) => [f.key, f.reason])).toEqual([["ECB_DEPOSIT_RATE", "Réponse HTTP 503 : boom"], ["FR_INFLATION", "redirect mode is set to error"]]);
    const views = await market.indicators(new Date("2026-10-21T09:00:00Z"));
    expect(views.find((v) => v.key === "ECB_DEPOSIT_RATE")).toMatchObject({ valueBp: 175, status: "ok" });
    expect(views.find((v) => v.key === "FR_10Y_YIELD")).toMatchObject({ valueBp: 360, observedAt: "2026-10" });
  });

  it("rejette les réponses invraisemblables, malformées ou démesurées", async () => {
    const bad = fakeFetch((url) => {
      if (url.pathname.includes("DFR")) return ok(csv("2026-09-10", "175"));
      if (url.pathname.includes("prc_hicp")) return ok("<html>Maintenance</html>");
      return ok("TIME_PERIOD,OBS_VALUE\n" + "x".repeat(1_200_000));
    });
    const report = await market.refresh(NOW, bad);
    expect(report.ok).toEqual([]);
    expect(report.failed.map((f) => [f.key, f.reason])).toEqual([
      ["ECB_DEPOSIT_RATE", expect.stringContaining("invraisemblable")],
      ["FR_10Y_YIELD", expect.stringContaining("trop volumineuse")],
      ["FR_INFLATION", expect.stringContaining("Format inattendu")],
    ]);
    expect(await prisma.marketSnapshot.count()).toBe(0);
  });
});

describe("adresses candidates et diagnostic", () => {
  it("ne contredit jamais le paramètre format par un en-tête Accept restrictif (Eurostat répondait 406)", async () => {
    const f = good() as unknown as ReturnType<typeof vi.fn>;
    await market.refresh(NOW, f as unknown as typeof fetch);
    for (const [, init] of f.mock.calls as [URL, RequestInit][]) expect(JSON.stringify(init.headers)).not.toContain("text/csv");
  });

  it("bascule sur l'adresse suivante quand la première répond 404, et garde l'ordre prévu", async () => {
    const f = fakeFetch((url) => {
      if (url.pathname.includes("/IRS/")) return new Response("Series not found", { status: 404 });
      if (url.pathname.includes("DFR")) return ok(csv("2026-09-16", "2.50"));
      if (url.pathname.includes("prc_hicp")) return ok(csv("2026-09", "1.2"));
      return ok(csv("2026-09", "3.30"));
    });
    const report = await market.refresh(NOW, f);
    expect(report).toEqual({ ok: ["ECB_DEPOSIT_RATE", "FR_10Y_YIELD", "FR_INFLATION"], failed: [] });
    const paths = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[0] as URL).pathname);
    expect(paths.findIndex((p: string) => p.includes("/IRS/"))).toBeLessThan(paths.findIndex((p: string) => p.includes("irt_lt_mcby_m")));
    expect((await prisma.marketSnapshot.findFirstOrThrow({ where: { key: "FR_10Y_YIELD" } })).valueBp).toBe(330);
  });

  it("détaille chaque tentative (hôte, chemin, statut, extrait) quand toutes les adresses échouent", async () => {
    const f = fakeFetch((url) => (url.pathname.includes("DFR") ? ok(csv("2026-09-16", "2.50")) : url.pathname.includes("prc_hicp") ? ok(csv("2026-09", "1.2")) : new Response("<html><body>Not   Found</body></html>", { status: 404 })));
    const report = await market.refresh(NOW, f);
    const failure = report.failed.find((x) => x.key === "FR_10Y_YIELD")!;
    expect(failure.reason).toContain("data-api.ecb.europa.eu/service/data/IRS/M.FR.L.L40.CI.0000.EUR.N.Z : Réponse HTTP 404 : Not Found");
    expect(failure.reason).toContain("ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/irt_lt_mcby_m");
    expect(failure.reason).toContain(" | ");
    expect(failure.reason).not.toContain("<");
  });
});

describe("rafraîchissement périodique", () => {
  it("ne contacte les sources que si une donnée manque ou a plus de 24 h", async () => {
    const first = vi.spyOn(market, "refresh").mockResolvedValue({ ok: [], failed: [] });
    expect(await market.refreshIfDue(NOW)).not.toBeNull();
    first.mockRestore();

    await market.refresh(NOW, good());
    const spy = vi.spyOn(market, "refresh").mockResolvedValue({ ok: [], failed: [] });
    expect(await market.refreshIfDue(new Date("2026-10-20T20:00:00Z"))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(await market.refreshIfDue(new Date("2026-10-21T09:00:00Z"))).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("n'effectue aucun appel sortant en test ni avec MARKET_REFRESH=off", () => {
    expect(market.refreshEnabled).toBe(false);
    const env = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.MARKET_REFRESH = "off";
    expect(market.refreshEnabled).toBe(false);
    process.env.MARKET_REFRESH = "on";
    expect(market.refreshEnabled).toBe(true);
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.MARKET_REFRESH === undefined) delete process.env.MARKET_REFRESH;
    else process.env.MARKET_REFRESH = env.MARKET_REFRESH;
  });
});

describe("état des indicateurs et API", () => {
  const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });

  it("signale « indisponible » sans donnée, « ok » si récente, « ancienne » après 4 jours sans mise à jour", async () => {
    expect((await market.indicators(NOW)).map((v) => v.status)).toEqual(["unavailable", "unavailable", "unavailable"]);
    await market.refresh(NOW, good());
    expect((await market.indicators(new Date("2026-10-22T08:00:00Z"))).every((v) => v.status === "ok")).toBe(true);
    expect((await market.indicators(new Date("2026-10-30T08:00:00Z"))).every((v) => v.status === "stale")).toBe(true);
  });

  it("GET /market exige une session et renvoie taux réglementés, indicateurs et avertissement", async () => {
    expect((await get(app, "/market")).statusCode).toBe(401);
    expect((await get(app, "/savings/products")).statusCode).toBe(401);
    await market.refresh(new Date(), good());
    const c = await register();
    const res = (await get(app, "/market", c)).json();
    expect(res.regulated.current.livretABp).toBeGreaterThan(0);
    expect(res.regulated.nextRevision).toMatch(/^\d{4}-(02|08)-01$/);
    expect(res.regulated.pel).toMatchObject({ openedIn: 2026, rateBp: 200 });
    expect(res.indicators).toHaveLength(3);
    expect(res.indicators[0]).toMatchObject({ key: "ECB_DEPOSIT_RATE", valueBp: 175, status: "ok" });
    expect(res.refreshEnabled).toBe(false);
    expect(res.disclaimer).toContain("non constitutives d'un conseil en investissement");
  });

  it("est lisible par un enfant et liste les fiches avec les taux de référence", async () => {
    const a = await register();
    await post(app, "/household/members", { email: "kid@example.com", password: "mot-de-passe-enfant-1", displayName: "Kid", role: "CHILD" }, a);
    const kid = { access: sessionCookies(await post(app, "/auth/login", { email: "kid@example.com", password: "mot-de-passe-enfant-1" })).access! };
    expect((await get(app, "/market", kid)).statusCode).toBe(200);
    const products = (await get(app, "/savings/products", kid)).json();
    expect(products.products.map((p: { id: string }) => p.id)).toContain("livret-a");
    expect(products.disclaimer).toContain("pédagogique");
  });
});
