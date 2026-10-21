import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, PushSender, type PushPayload, type PushTarget } from "../src/push/push.sender.js";
import { ReminderService } from "../src/reminder/reminder.service.js";
import { get, owner, post, resetDb, sessionCookies, startApp, admin } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const put = (url: string, payload: object, cookies: { access: string }) => app.inject({ method: "PUT", url, payload, cookies });
const del = (url: string, payload: object, cookies: { access: string }) => app.inject({ method: "DELETE", url, payload, cookies });
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const sub = (endpoint = ENDPOINT) => ({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } });
const SETTINGS = { enabled: true, weekday: 7, hour: 18, timezone: "Europe/Paris" };
const NOW = new Date("2026-01-14T12:00:00Z"); // mercredi ; dernier créneau : dimanche 11 janvier 18h Paris

class FakeSender extends PushSender {
  publicKey = "fake-key";
  sent: { target: PushTarget; payload: PushPayload }[] = [];
  result: "ok" | "gone" | "error" = "ok";
  async send(target: PushTarget, payload: PushPayload) {
    this.sent.push({ target, payload });
    return this.result;
  }
}

/** Active le rappel puis recule `since` pour simuler un rappel activé la semaine précédente. */
async function enableInThePast(c: { access: string }) {
  await put("/reminder", SETTINGS, c);
  await admin.reminderSetting.updateMany({ data: { since: new Date("2026-01-01T00:00:00Z") } });
}

describe("réglages du rappel", () => {
  it("renvoie des valeurs par défaut désactivées puis enregistre les réglages", async () => {
    const c = await register();
    expect((await get(app, "/reminder", c)).json()).toMatchObject({ enabled: false, weekday: 7, hour: 18, due: false, subscribed: false, pushConfigured: false });
    const saved = await put("/reminder", { enabled: true, weekday: 1, hour: 9, timezone: "Europe/Paris" }, c);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, weekday: 1, hour: 9 });
  });

  it("refuse un jour, une heure ou un fuseau invalides", async () => {
    const c = await register();
    for (const bad of [{ weekday: 8 }, { weekday: 0 }, { hour: 24 }, { hour: -1 }, { timezone: "Nope/Zone" }, { enabled: "oui" }]) {
      expect((await put("/reminder", { ...SETTINGS, ...bad }, c)).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/reminder" })).statusCode).toBe(401);
  });

  it("n'est pas dû juste après l'activation (pas de rappel rétroactif), l'est après un créneau, et « bilan fait » l'éteint", async () => {
    const c = await register();
    await put("/reminder", SETTINGS, c);
    expect((await get(app, "/reminder", c)).json().due).toBe(false);

    const prisma = admin;
    await prisma.reminderSetting.updateMany({ data: { since: new Date("2000-01-01T00:00:00Z") } });
    expect((await get(app, "/reminder", c)).json().due).toBe(true);

    const done = await post(app, "/reminder/done", undefined, c);
    expect(done.json()).toMatchObject({ due: false });
    expect(done.json().lastDoneAt).not.toBeNull();
    expect((await get(app, "/household/audit", c)).json().some((e: { action: string }) => e.action === "review.done")).toBe(true);
  });

  it("un enfant gère son propre rappel", async () => {
    const a = await register();
    await post(app, "/household/members", { email: "kid@example.com", password: "mot-de-passe-enfant-1", displayName: "Kid", role: "CHILD" }, a);
    const kid = { access: sessionCookies(await post(app, "/auth/login", { email: "kid@example.com", password: "mot-de-passe-enfant-1" })).access! };
    expect((await put("/reminder", SETTINGS, kid)).statusCode).toBe(200);
    expect((await get(app, "/reminder", a)).json().enabled).toBe(false);
  });
});

describe("abonnements push", () => {
  it("n'accepte que les services push connus (anti-SSRF)", async () => {
    const c = await register();
    for (const endpoint of [
      "https://evil.example.com/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.com/x",
      "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://127.0.0.1/x",
    ]) {
      expect((await post(app, "/push/subscriptions", sub(endpoint), c)).statusCode).toBe(400);
    }
    for (const endpoint of [ENDPOINT, "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/x", "https://web.push.apple.com/x"]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(true);
    }
    expect(isAllowedPushEndpoint("pas une url")).toBe(false);
    expect((await post(app, "/push/subscriptions", sub(), c)).statusCode).toBe(201);
    expect((await get(app, "/reminder", c)).json().subscribed).toBe(true);
    expect((await get(app, "/push/config", c)).json()).toEqual({ publicKey: null });
  });

  it("ne supprime pas l'abonnement d'un autre utilisateur", async () => {
    const a = await register(1);
    const b = await register(2);
    await post(app, "/push/subscriptions", sub(), a);
    await del("/push/subscriptions", { endpoint: ENDPOINT }, b);
    expect((await get(app, "/reminder", a)).json().subscribed).toBe(true);
    await del("/push/subscriptions", { endpoint: ENDPOINT }, a);
    expect((await get(app, "/reminder", a)).json().subscribed).toBe(false);
  });
});

describe("planificateur", () => {
  it("envoie une notification sans donnée financière, une seule fois par créneau", async () => {
    const c = await register();
    await post(app, "/push/subscriptions", sub(), c);
    await enableInThePast(c);
    const reminders = app.get(ReminderService);
    const sender = new FakeSender();

    expect(await reminders.runOnce(NOW, sender)).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.payload).toEqual({ title: "Gest-finance", body: "C'est l'heure de faire les comptes de la semaine.", url: "/?bilan=1" });
    expect(await reminders.runOnce(new Date("2026-01-14T18:00:00Z"), sender)).toBe(0);
    expect(sender.sent).toHaveLength(1);
    // créneau suivant (dimanche 18 janvier 18h Paris = 17h UTC)
    expect(await reminders.runOnce(new Date("2026-01-18T17:01:00Z"), sender)).toBe(1);
  });

  it("n'envoie rien si le bilan est déjà fait, si le rappel est désactivé ou sans abonnement", async () => {
    const c = await register();
    const reminders = app.get(ReminderService);
    const sender = new FakeSender();
    await enableInThePast(c);
    expect(await reminders.runOnce(NOW, sender)).toBe(0); // pas d'abonnement

    await post(app, "/push/subscriptions", sub(), c);
    await admin.reminderSetting.updateMany({ data: { lastDoneAt: new Date("2026-01-12T08:00:00Z") } });
    expect(await reminders.runOnce(NOW, sender)).toBe(0); // bilan fait depuis le créneau

    await admin.reminderSetting.updateMany({ data: { lastDoneAt: null, enabled: false } });
    expect(await reminders.runOnce(NOW, sender)).toBe(0); // désactivé
    expect(sender.sent).toHaveLength(0);
  });

  it("supprime les abonnements expirés et réessaie plus tard si l'envoi échoue", async () => {
    const c = await register();
    await post(app, "/push/subscriptions", sub(), c);
    await enableInThePast(c);
    const reminders = app.get(ReminderService);
    const sender = new FakeSender();

    sender.result = "error";
    expect(await reminders.runOnce(NOW, sender)).toBe(0);
    sender.result = "gone";
    expect(await reminders.runOnce(NOW, sender)).toBe(0);
    expect((await get(app, "/reminder", c)).json().subscribed).toBe(false);
  });

  it("ne fait rien tant que les notifications ne sont pas configurées (pas de clé VAPID)", async () => {
    const c = await register();
    await post(app, "/push/subscriptions", sub(), c);
    await enableInThePast(c);
    expect(await app.get(ReminderService).runOnce(NOW)).toBe(0);
  });
});

describe("bilan de la semaine", () => {
  async function seed(c: { access: string }) {
    const accountId = (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id;
    await post(app, "/transactions", { accountId, amountCents: -2_500, date: "2026-10-03", label: "Courses" }, c);
    await post(app, "/transactions", { accountId, amountCents: 1_000, date: "2026-10-07", label: "Remboursement" }, c);
    await post(app, "/transactions", { accountId, amountCents: -9_999, date: "2026-09-20", label: "Hors semaine" }, c);
    await post(app, "/recurring-rules", { accountId, label: "Loyer", amountCents: -80_000, frequency: "MONTHLY", start: "2026-01-05" }, c);
    await post(app, "/recurring-rules", { accountId, label: "Assurance", amountCents: -5_000, frequency: "MONTHLY", start: "2026-01-12" }, c);
  }

  it("résume les 7 derniers jours, les récurrences échues et les échéances à venir", async () => {
    const c = await register();
    await seed(c);
    const r = (await get(app, "/review/weekly?to=2026-10-08", c)).json();
    expect(r).toMatchObject({ from: "2026-10-02", to: "2026-10-08", incomeCents: 1_000, expensesCents: 82_500 });
    expect(r.transactions.map((t: { label: string }) => t.label)).toEqual(["Remboursement", "Courses"]);
    expect(r.recurringInPeriod).toEqual([{ date: "2026-10-05", label: "Loyer", account: "Courant", amountCents: -80_000 }]);
    expect(r.upcoming).toEqual([{ date: "2026-10-12", label: "Assurance", account: "Courant", amountCents: -5_000 }]);
    expect(r.month).toMatchObject({ from: "2026-10-01", to: "2026-10-31", fixedChargesCents: 85_000, oneOffExpensesCents: 2_500, incomeCents: 1_000 });
  });

  it("est isolé par foyer, lisible par un enfant, et valide la date", async () => {
    const a = await register(1);
    const b = await register(2);
    await seed(a);
    const other = (await get(app, "/review/weekly?to=2026-10-08", b)).json();
    expect(other.transactions).toEqual([]);
    expect(other.recurringInPeriod).toEqual([]);
    expect(other.expensesCents).toBe(0);
    expect((await get(app, "/review/weekly?to=pas-une-date", a)).statusCode).toBe(400);

    await post(app, "/household/members", { email: "kid@example.com", password: "mot-de-passe-enfant-1", displayName: "Kid", role: "CHILD" }, a);
    const kid = { access: sessionCookies(await post(app, "/auth/login", { email: "kid@example.com", password: "mot-de-passe-enfant-1" })).access! };
    expect((await get(app, "/review/weekly?to=2026-10-08", kid)).statusCode).toBe(200);
    expect((await get(app, "/review/weekly")).statusCode).toBe(401);
  });
});
