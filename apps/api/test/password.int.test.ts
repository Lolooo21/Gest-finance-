import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MailSender, type MailMessage } from "../src/mail/mail.sender.js";
import { admin, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
let send: MockInstance<(m: MailMessage) => Promise<boolean>>;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app);
  await admin.passwordResetToken.deleteMany();
  vi.restoreAllMocks();
  send = vi.spyOn(app.get(MailSender), "send").mockResolvedValue(true);
});

const NEW_PASSWORD = "nouveau-mot-de-passe-solide";
const register = async () => sessionCookies(await post(app, "/auth/register", owner()));
const login = (password: string) => post(app, "/auth/login", { email: owner().email, password });
/** L'e-mail part en arrière-plan : on attend son envoi, puis on lit le jeton dans le lien. */
async function requestLink(email = owner().email): Promise<string> {
  const calls = send.mock.calls.length;
  expect((await post(app, "/auth/password/forgot", { email })).statusCode).toBe(202);
  await vi.waitFor(() => expect(send.mock.calls.length).toBe(calls + 1));
  return /reinitialisation=([A-Za-z0-9_-]+)/.exec(send.mock.calls.at(-1)![0].text)![1]!;
}

describe("réinitialisation du mot de passe", () => {
  it("envoie un lien à usage unique au titulaire du compte, sans révéler les adresses inconnues", async () => {
    await register();
    const unknown = await post(app, "/auth/password/forgot", { email: "Inconnu@Example.com" });
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toEqual({ ok: true });

    const token = await requestLink(owner().email.toUpperCase());
    const mail = send.mock.calls.at(-1)![0];
    expect(mail.to).toBe(owner().email);
    expect(mail.subject).toMatch(/réinitialisation/);
    expect(mail.text).toContain(`http://localhost:5173/?reinitialisation=${token}`);
    expect(mail.text).toMatch(/30 minutes/);
    // L'adresse inconnue n'a déclenché aucun envoi ; seule l'empreinte du jeton est en base.
    expect(send).toHaveBeenCalledTimes(1);
    const row = await admin.passwordResetToken.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("change le mot de passe, déverrouille le compte, ferme les sessions et refuse un second usage", async () => {
    const session = await register();
    for (let i = 0; i < 5; i++) await login("mauvais-mot-de-passe");
    expect((await login("correct-horse-battery")).statusCode).toBe(403);

    const token = await requestLink();
    const reset = await post(app, "/auth/password/reset", { token, password: NEW_PASSWORD });
    expect(reset.statusCode).toBe(200);
    expect((await login("correct-horse-battery")).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
    // Sessions ouvertes avant la réinitialisation : leur jeton de rafraîchissement est révoqué.
    expect((await post(app, "/auth/refresh", undefined, { refresh: session.refresh! })).statusCode).toBe(401);

    const again = await post(app, "/auth/password/reset", { token, password: "encore-un-autre-mot-de-passe" });
    expect(again.statusCode).toBe(400);
    expect(again.json().message).toMatch(/Lien invalide ou expiré/);
  });

  it("refuse un lien expiré, remplacé par un plus récent, inconnu ou mal formé, et un mot de passe trop court", async () => {
    await register();
    const first = await requestLink();
    const second = await requestLink();
    expect((await post(app, "/auth/password/reset", { token: first, password: NEW_PASSWORD })).statusCode).toBe(400);

    await admin.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post(app, "/auth/password/reset", { token: second, password: NEW_PASSWORD })).statusCode).toBe(400);

    const third = await requestLink();
    expect((await post(app, "/auth/password/reset", { token: third, password: "court" })).statusCode).toBe(400);
    expect((await post(app, "/auth/password/reset", { token: "A".repeat(43), password: NEW_PASSWORD })).statusCode).toBe(400);
    expect((await post(app, "/auth/password/reset", { token: "pas un jeton", password: NEW_PASSWORD })).statusCode).toBe(400);
    expect((await post(app, "/auth/password/forgot", { email: "pas-une-adresse" })).statusCode).toBe(400);
    expect((await post(app, "/auth/password/reset", { token: third, password: NEW_PASSWORD })).statusCode).toBe(200);
  });

  it("journalise sans jeton ni adresse, et signale un e-mail non envoyé (SMTP absent ou en échec)", async () => {
    await register();
    const token = await requestLink();
    send.mockResolvedValue(false);
    await post(app, "/auth/password/forgot", { email: owner().email });
    await vi.waitFor(async () => expect((await admin.auditLog.findMany()).map((l) => l.action)).toContain("auth.password_reset_not_sent"));
    const log = JSON.stringify(await admin.auditLog.findMany());
    expect(log).toContain("auth.password_reset_requested");
    expect(log).not.toContain(token);
    expect(log).not.toContain(owner().email);
  });

  it("limite les demandes de lien à 5 par minute et par adresse IP", async () => {
    const limited = await startApp(1000, 5);
    try {
      vi.spyOn(limited.get(MailSender), "send").mockResolvedValue(true);
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) codes.push((await limited.inject({ method: "POST", url: "/auth/password/forgot", payload: { email: "x@example.com" } })).statusCode);
      expect(codes).toEqual([202, 202, 202, 202, 202, 429]);
    } finally {
      await limited.close();
    }
  });
});
