import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptExistingFields } from "../scripts/encrypt-fields.js";
import { ENCRYPTED_PREFIX } from "../src/crypto/field-cipher.js";
import { admin, fieldCipher, get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

async function setup() {
  const c = { access: sessionCookies(await post(app, "/auth/register", owner(1))).access! };
  const account = (await post(app, "/accounts", { name: "Joint", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id as string;
  return { c, account };
}

describe("chiffrement des champs sensibles en base", () => {
  it("les libellés, notes et employeurs sont chiffrés en base et lus en clair par l'application", async () => {
    const { c, account } = await setup();
    await post(app, "/transactions", { accountId: account, amountCents: -4_200, date: "2026-11-10", label: "Pharmacie du Port" }, c);
    await post(app, "/recurring-rules", { accountId: account, label: "Crèche Les Lutins", amountCents: -30_000, frequency: "MONTHLY", start: "2026-11-01" }, c);
    const goal = (await post(app, "/goals/savings", { name: "Vacances", kind: "SHORT_TERM", targetCents: 100_000, targetDate: "2027-07-01" }, c)).json().id as string;
    expect((await post(app, `/goals/savings/${goal}/contributions`, { amountCents: 5_000, date: "2026-11-10", note: "Prime de Noël" }, c)).statusCode).toBe(201);

    const [tx] = await admin.transaction.findMany();
    const [rule] = await admin.recurringRule.findMany();
    const [contribution] = await admin.savingsContribution.findMany();
    for (const stored of [tx!.label, rule!.label, contribution!.note!]) {
      expect(stored.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(stored).not.toMatch(/Pharmacie|Crèche|Prime/);
    }
    const dump = JSON.stringify(await admin.$queryRaw`SELECT label FROM "Transaction" UNION ALL SELECT label FROM "RecurringRule"`);
    expect(dump).not.toMatch(/Pharmacie|Crèche/);

    expect((await get(app, "/transactions", c)).json()[0].label).toBe("Pharmacie du Port");
    expect((await get(app, "/recurring-rules", c)).json()[0].label).toBe("Crèche Les Lutins");
    const exported = (await post(app, "/privacy/export", { password: owner(1).password }, c)).json();
    expect(exported.transactions[0].label).toBe("Pharmacie du Port");
    expect(exported.savingsGoals[0].contributions[0].note).toBe("Prime de Noël");

    // La modification rechiffre ; la catégorisation (qui lit les libellés) fonctionne sur les valeurs déchiffrées.
    const id = (await get(app, "/transactions", c)).json()[0].id as string;
    await app.inject({ method: "PATCH", url: `/transactions/${id}`, payload: { label: "Pharmacie centrale" }, cookies: c });
    const updated = await admin.transaction.findUniqueOrThrow({ where: { id } });
    expect(updated.label.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(fieldCipher.decryptField(updated.label)).toBe("Pharmacie centrale");
  });

  it("le script de déploiement chiffre les données d'avant, sans rien changer à ce qui est déjà chiffré", async () => {
    const { c, account } = await setup();
    const householdId = (await admin.bankAccount.findUniqueOrThrow({ where: { id: account } })).householdId;
    await admin.transaction.create({ data: { householdId, accountId: account, amountCents: -1_000, date: new Date("2026-11-01"), label: "Ancien libellé" } });
    await post(app, "/transactions", { accountId: account, amountCents: -2_000, date: "2026-11-02", label: "Déjà chiffré" }, c);
    const before = (await admin.transaction.findMany({ orderBy: { date: "asc" } })).map((t) => t.label);
    expect(before[0]).toBe("Ancien libellé");
    // Avant le script, l'ancien libellé en clair reste lisible.
    expect((await get(app, "/transactions", c)).json().map((t: { label: string }) => t.label).sort()).toEqual(["Ancien libellé", "Déjà chiffré"]);

    expect(await encryptExistingFields(admin, fieldCipher)).toMatchObject({ "Transaction.label": 1 });
    const after = (await admin.transaction.findMany({ orderBy: { date: "asc" } })).map((t) => t.label);
    expect(after[0]!.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(after[1]).toBe(before[1]);
    expect((await get(app, "/transactions", c)).json().map((t: { label: string }) => t.label).sort()).toEqual(["Ancien libellé", "Déjà chiffré"]);
    expect(Object.values(await encryptExistingFields(admin, fieldCipher)).every((n) => n === 0)).toBe(true);
  });
});
