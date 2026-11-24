import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { csrfRejection } from "../src/app.js";
import { passwordProblem } from "../src/auth/password-policy.js";
import { admin, get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async (n = 1) => sessionCookies(await post(app, "/auth/register", owner(n)));
const account = { name: "Courant", type: "CHECKING", initialBalanceCents: 0 };
const postWith = (url: string, payload: object, cookies: Record<string, string>, headers: Record<string, string>) =>
  app.inject({ method: "POST", url, payload, cookies, headers });

describe("CSRF", () => {
  it("refuse une requête qui modifie des données depuis un autre site, accepte l'application elle-même", async () => {
    const c = { access: (await register()).access! };
    expect((await postWith("/accounts", account, c, { origin: "https://site-malveillant.example" })).statusCode).toBe(403);
    expect((await postWith("/accounts", account, c, { "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
    expect((await postWith("/accounts", account, c, { origin: "null" })).statusCode).toBe(403);
    const refused = await postWith("/accounts", account, c, { origin: "https://site-malveillant.example" });
    expect(refused.json().message).toMatch(/ne provient pas de l'application/);
    expect(await admin.bankAccount.count()).toBe(0);

    // Même origine que l'hôte appelé (inject : localhost:80), même site, ou sans Origin (outil en ligne de commande).
    expect((await postWith("/accounts", account, c, { origin: "http://localhost:80", "sec-fetch-site": "same-origin" })).statusCode).toBe(201);
    expect((await post(app, "/accounts", account, c)).statusCode).toBe(201);
    // Une lecture n'est jamais bloquée.
    expect((await app.inject({ method: "GET", url: "/accounts", cookies: c, headers: { origin: "https://site-malveillant.example" } })).statusCode).toBe(200);
  });

  it("compare l'origine à l'hôte, à APP_URL et aux origines déclarées", () => {
    const h = (origin: string, extra: Record<string, string> = {}) => ({ host: "gest.example.ts.net", origin, ...extra });
    expect(csrfRejection("GET", h("https://evil.example"))).toBeNull();
    expect(csrfRejection("POST", h("https://gest.example.ts.net"))).toBeNull();
    expect(csrfRejection("DELETE", h("https://evil.example"))).toBe("origin");
    expect(csrfRejection("PATCH", h("pas une url"))).toBe("origin");
    expect(csrfRejection("POST", { host: "api:3000", "x-forwarded-host": "gest.example.ts.net", origin: "https://gest.example.ts.net" })).toBeNull();
    process.env.APP_URL = "https://app.example.ts.net";
    process.env.CSRF_TRUSTED_ORIGINS = "http://localhost:5173, https://autre.example";
    try {
      expect(csrfRejection("POST", h("https://app.example.ts.net"))).toBeNull();
      expect(csrfRejection("POST", h("http://localhost:5173"))).toBeNull();
      expect(csrfRejection("PUT", h("https://autre.example"))).toBeNull();
    } finally {
      process.env.APP_URL = "";
      delete process.env.CSRF_TRUSTED_ORIGINS;
    }
  });
});

describe("force brute", () => {
  it("plafonne les tentatives d'authentification par IP, sans gêner le reste de l'API", async () => {
    const limited = await startApp(1000, 1000, 3);
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await limited.inject({ method: "POST", url: "/auth/login", payload: { email: "x@example.com", password: "mauvais" } })).statusCode);
      expect(codes).toEqual([401, 401, 401, 429]);
      expect((await limited.inject({ method: "POST", url: "/auth/register", payload: owner() })).statusCode).toBe(429);
      expect((await limited.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it("verrouille le compte après 5 échecs, et un mauvais mot de passe actuel compte comme un échec", async () => {
    const c = await register();
    for (let i = 0; i < 4; i++) await post(app, "/auth/login", { email: owner().email, password: "mauvais-mot-de-passe" });
    const change = await post(app, "/auth/password/change", { currentPassword: "pas-le-bon", newPassword: "une-phrase-tout-a-fait-neuve" }, { access: c.access! });
    expect(change.statusCode).toBe(400);
    expect((await post(app, "/auth/login", { email: owner().email, password: owner().password })).statusCode).toBe(403);
  });
});

describe("sessions", () => {
  it("le changement de mot de passe coupe aussitôt les jetons déjà émis et ouvre une nouvelle session", async () => {
    const old = await register();
    expect((await get(app, "/accounts", { access: old.access! })).statusCode).toBe(200);
    expect((await post(app, "/auth/password/change", { currentPassword: owner().password, newPassword: "court" }, { access: old.access! })).statusCode).toBe(400);
    expect((await post(app, "/auth/password/change", { currentPassword: owner().password, newPassword: "azerty1234567" }, { access: old.access! })).statusCode).toBe(400);

    const changed = await post(app, "/auth/password/change", { currentPassword: owner().password, newPassword: "une-phrase-tout-a-fait-neuve" }, { access: old.access! });
    expect(changed.statusCode).toBe(200);
    const fresh = sessionCookies(changed);
    expect((await get(app, "/accounts", { access: old.access! })).statusCode).toBe(401);
    expect((await post(app, "/auth/refresh", undefined, { refresh: old.refresh! })).statusCode).toBe(401);
    // … sans fausse alerte de vol : la nouvelle session reste ouverte.
    expect((await get(app, "/accounts", { access: fresh.access! })).statusCode).toBe(200);
    expect((await post(app, "/auth/login", { email: owner().email, password: "une-phrase-tout-a-fait-neuve" })).statusCode).toBe(200);
    expect(JSON.stringify((await admin.auditLog.findMany()).map((l) => l.action))).toContain("auth.password_changed");
  });

  it("la réutilisation d'un jeton de rafraîchissement volé coupe aussi les jetons d'accès", async () => {
    const first = await register();
    const second = sessionCookies(await post(app, "/auth/refresh", undefined, { refresh: first.refresh! }));
    expect((await get(app, "/accounts", { access: second.access! })).statusCode).toBe(200);
    expect((await post(app, "/auth/refresh", undefined, { refresh: first.refresh! })).statusCode).toBe(401);
    expect((await get(app, "/accounts", { access: second.access! })).statusCode).toBe(401);
  });

  it("refuse un jeton sans version de session, sans session, d'une session d'un autre, non signé, ou signé avec un autre algorithme", async () => {
    await register();
    const user = await admin.user.findFirstOrThrow();
    const { sessionId } = await admin.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    const claims = { userId: user.id, householdId: user.householdId, role: "OWNER", sid: sessionId };
    const secret = process.env.JWT_SECRET!;
    // Session ouverte par un autre utilisateur (autre foyer) : son identifiant ne vaut rien avec mon userId.
    await register(2);
    const other = await admin.user.findFirstOrThrow({ where: { NOT: { id: user.id } } });
    const { sessionId: otherSession } = await admin.refreshToken.findFirstOrThrow({ where: { userId: other.id } });
    const { sid: _sid, ...noSession } = claims;
    void _sid;
    for (const access of [
      jwt.sign(claims, secret, { algorithm: "HS256", expiresIn: "15m" }),
      jwt.sign({ ...noSession, sv: 0 }, secret, { algorithm: "HS256", expiresIn: "15m" }),
      jwt.sign({ ...claims, sv: 0, sid: otherSession }, secret, { algorithm: "HS256", expiresIn: "15m" }),
      jwt.sign({ ...claims, sv: 0, sid: "session-inventee" }, secret, { algorithm: "HS256", expiresIn: "15m" }),
      jwt.sign({ ...claims, sv: 0 }, secret, { algorithm: "HS512", expiresIn: "15m" }),
      jwt.sign({ ...claims, sv: 0 }, "", { algorithm: "none" }),
    ]) {
      expect((await get(app, "/accounts", { access })).statusCode).toBe(401);
    }
    expect((await get(app, "/accounts", { access: jwt.sign({ ...claims, sv: 0 }, secret, { algorithm: "HS256", expiresIn: "15m" }) })).statusCode).toBe(200);
  });
});

describe("inscription", () => {
  it("est ouverte pour créer le premier foyer, puis fermée", async () => {
    process.env.ALLOW_REGISTRATION = "";
    try {
      expect((await get(app, "/auth/registration")).json()).toEqual({ open: true });
      expect((await post(app, "/auth/register", owner(1))).statusCode).toBe(201);
      expect((await get(app, "/auth/registration")).json()).toEqual({ open: false });
      const closed = await post(app, "/auth/register", owner(2));
      expect(closed.statusCode).toBe(403);
      expect(closed.json().message).toMatch(/Inscription fermée/);
      expect(await admin.household.count()).toBe(1);
    } finally {
      process.env.ALLOW_REGISTRATION = "1";
    }
  });

  it("refuse un mot de passe faible ou qui reprend le nom, l'e-mail ou le foyer", async () => {
    for (const password of ["123456789012", "aaaaaaaaaaaa", "Azerty123456", "MotDePasse2026!", "owner1-et-sa-banque", "foyer-familial-2026"]) {
      expect((await post(app, "/auth/register", { ...owner(1), password })).statusCode, password).toBe(400);
    }
    expect(await admin.household.count()).toBe(0);
  });
});

describe("politique de mot de passe", () => {
  it("explique chaque refus et accepte une phrase de passe", () => {
    expect(passwordProblem("000000000000")).toMatch(/chiffres/);
    expect(passwordProblem("abababababab")).toMatch(/répétés/);
    expect(passwordProblem("P@ssw0rd-2026")).toBeNull();
    expect(passwordProblem("Password2026!")).toMatch(/courant/);
    expect(passwordProblem("Bonjour-1234")).toMatch(/courant/);
    expect(passwordProblem("leamartin-2026", ["lea.martin@example.com"])).toMatch(/nom/);
    expect(passwordProblem("lea-voyage-2026", ["lea.martin@example.com"])).toBeNull(); // « lea » : moins de 4 lettres
    expect(passwordProblem("martin-et-co-2026", ["lea.martin@example.com"])).toMatch(/nom/);
    expect(passwordProblem("Les Dupont 2026 !", ["", "Famille Dupont"])).toMatch(/foyer/);
    expect(passwordProblem("cheval agrafe batterie correcte")).toBeNull();
  });
});

describe("injection SQL", () => {
  it("n'utilise jamais de requête SQL construite par concaténation dans l'API", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    const offenders = files(join(__dirname, "../src"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\$(queryRaw|executeRaw)Unsafe|Prisma\.raw\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("enregistre tel quel un libellé piégé, sans effet sur la base", async () => {
    const c = { access: (await register()).access! };
    const accountId = (await post(app, "/accounts", account, c)).json().id;
    const label = `'); DROP TABLE "Transaction"; --`;
    expect((await post(app, "/transactions", { accountId, amountCents: -100, date: "2026-11-01", label, categoryId: null }, c)).statusCode).toBe(201);
    expect((await get(app, "/transactions", c)).json()[0].label).toBe(label);
    expect((await get(app, "/transactions?limit=1%20OR%201=1", c)).statusCode).toBe(200);
    expect(await admin.transaction.count()).toBe(1);
  });
});

describe("en-têtes", () => {
  it("interdit la mise en cache des réponses de l'API", async () => {
    const c = { access: (await register()).access! };
    expect((await get(app, "/accounts", c)).headers["cache-control"]).toBe("no-store");
    expect((await get(app, "/health")).headers["cache-control"]).toBe("no-store");
  });
});
