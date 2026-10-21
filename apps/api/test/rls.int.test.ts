import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAppClient, createSystemClient, runInHousehold, scopeClient } from "../src/prisma/prisma.service.js";
import { admin, resetDb } from "./helpers.js";

const app: PrismaClient = createAppClient();
const system: PrismaClient = createSystemClient();
const scoped = scopeClient(app);
let a: string;
let b: string;

async function seed(name: string) {
  const user = await admin.user.create({
    data: { email: `${name}@example.com`, displayName: name, passwordHash: "x", role: "OWNER", household: { create: { name } } },
  });
  await admin.bankAccount.create({ data: { householdId: user.householdId, name: `Compte ${name}`, type: "CHECKING", initialBalanceCents: 100 } });
  return user.householdId;
}

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await resetDb();
  await app.$disconnect();
  await system.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  a = await seed("a");
  b = await seed("b");
});

describe("RLS : isolation par foyer en base", () => {
  it("toutes les tables du foyer ont la RLS activée (une nouvelle table sans RLS fait échouer ce test)", async () => {
    const rows = await admin.$queryRaw<{ name: string; rls: boolean }[]>`
      SELECT c.relname::text AS name, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
    const withoutRls = rows.filter((r) => !r.rls).map((r) => r.name);
    // Seule exception : les indicateurs de marché, publics et sans donnée personnelle.
    expect(withoutRls).toEqual(["MarketSnapshot"]);
  });

  it("ne renvoie que le foyer courant, même sans filtre dans la requête", async () => {
    const names = await runInHousehold(a, async () => await scoped.bankAccount.findMany({ select: { name: true } }));
    expect(names).toEqual([{ name: "Compte a" }]);
    const users = await runInHousehold(b, async () => await scoped.user.findMany({ select: { email: true } }));
    expect(users).toEqual([{ email: "b@example.com" }]);
  });

  it("refuse tout accès sans foyer dans le contexte (aucune lecture silencieusement vide)", async () => {
    await expect(scoped.bankAccount.findMany()).rejects.toThrow(/aucun foyer/);
    await expect(scoped.user.count()).rejects.toThrow(/aucun foyer/);
  });

  it("ne voit rien avec un foyer inconnu ou vide", async () => {
    expect(await runInHousehold("00000000-0000-0000-0000-000000000000", async () => await scoped.bankAccount.count())).toBe(0);
    // Hors du client étendu (pas de set_config) : la fonction renvoie NULL, donc aucune ligne ne correspond.
    expect(await app.bankAccount.count()).toBe(0);
    expect(await app.user.count()).toBe(0);
  });

  it("empêche de lire, modifier ou supprimer les lignes d'un autre foyer, même en connaissant leur identifiant", async () => {
    const other = await admin.bankAccount.findFirstOrThrow({ where: { householdId: b } });
    expect(await runInHousehold(a, async () => await scoped.bankAccount.findUnique({ where: { id: other.id } }))).toBeNull();
    expect((await runInHousehold(a, async () => await scoped.bankAccount.updateMany({ where: { id: other.id }, data: { name: "piraté" } }))).count).toBe(0);
    expect((await runInHousehold(a, async () => await scoped.bankAccount.deleteMany({ where: { id: other.id } }))).count).toBe(0);
    expect((await admin.bankAccount.findUniqueOrThrow({ where: { id: other.id } })).name).toBe("Compte b");
  });

  it("empêche d'écrire une ligne dans un autre foyer (contrôle WITH CHECK)", async () => {
    await expect(
      runInHousehold(a, async () => await scoped.bankAccount.create({ data: { householdId: b, name: "intrus", type: "CHECKING", initialBalanceCents: 0 } })),
    ).rejects.toThrow();
    expect(await admin.bankAccount.count({ where: { name: "intrus" } })).toBe(0);
    // Idem pour les tables rattachées à un utilisateur : jeton de rafraîchissement d'un utilisateur d'un autre foyer.
    const userB = await admin.user.findFirstOrThrow({ where: { householdId: b } });
    await expect(
      runInHousehold(a, async () => await scoped.refreshToken.create({ data: { userId: userB.id, tokenHash: "h", expiresAt: new Date(Date.now() + 1000) } })),
    ).rejects.toThrow();
  });

  it("isole aussi les tables rattachées à un utilisateur (jetons, rappels, abonnements)", async () => {
    const userA = await admin.user.findFirstOrThrow({ where: { householdId: a } });
    const userB = await admin.user.findFirstOrThrow({ where: { householdId: b } });
    await admin.refreshToken.createMany({
      data: [
        { userId: userA.id, tokenHash: "ta", expiresAt: new Date(Date.now() + 1000) },
        { userId: userB.id, tokenHash: "tb", expiresAt: new Date(Date.now() + 1000) },
      ],
    });
    await admin.reminderSetting.createMany({ data: [{ userId: userA.id }, { userId: userB.id }] });
    await admin.pushSubscription.createMany({
      data: [
        { userId: userA.id, endpoint: "https://fcm.googleapis.com/a", p256dh: "p", auth: "a" },
        { userId: userB.id, endpoint: "https://fcm.googleapis.com/b", p256dh: "p", auth: "a" },
      ],
    });
    expect((await runInHousehold(a, async () => await scoped.refreshToken.findMany())).map((t) => t.tokenHash)).toEqual(["ta"]);
    expect((await runInHousehold(a, async () => await scoped.reminderSetting.findMany())).map((r) => r.userId)).toEqual([userA.id]);
    expect((await runInHousehold(a, async () => await scoped.pushSubscription.findMany())).map((p) => p.endpoint)).toEqual(["https://fcm.googleapis.com/a"]);
  });

  it("ne mélange pas les foyers entre requêtes simultanées", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const household = i % 2 ? a : b;
        return runInHousehold(household, async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 10));
          const rows = await scoped.bankAccount.findMany({ select: { householdId: true } });
          return rows.every((r) => r.householdId === household) && rows.length === 1;
        });
      }),
    );
    expect(results.every(Boolean)).toBe(true);
  });

  it("ne laisse pas le foyer fixé sur la connexion une fois la requête terminée", async () => {
    await runInHousehold(a, async () => await scoped.bankAccount.count());
    const [row] = await app.$queryRaw<{ household: string | null }[]>`SELECT app_household() AS household`;
    expect(row?.household).toBeNull();
  });

  it("la transaction interactive reste dans le foyer et est atomique", async () => {
    await expect(
      runInHousehold(a, async () =>
        scoped.$householdTransaction(async (tx) => {
          await tx.bankAccount.create({ data: { householdId: a, name: "annulé", type: "SAVINGS", initialBalanceCents: 0 } });
          expect(await tx.bankAccount.count()).toBe(2);
          throw new Error("échec volontaire");
        }),
      ),
    ).rejects.toThrow("échec volontaire");
    expect(await admin.bankAccount.count({ where: { name: "annulé" } })).toBe(0);
    await expect(scoped.$householdTransaction(async () => 1)).rejects.toThrow(/aucun foyer/);
  });
});

describe("droits des rôles", () => {
  it("gest_app ne peut ni écrire ni modifier le journal d'audit", async () => {
    await expect(app.auditLog.createMany({ data: [{ householdId: a, action: "x" }] })).rejects.toThrow();
    await expect(app.$executeRaw`DELETE FROM "AuditLog"`).rejects.toThrow(/permission denied/);
  });

  it("gest_app ne modifie pas les indicateurs de marché", async () => {
    await expect(app.$executeRaw`DELETE FROM "MarketSnapshot"`).rejects.toThrow(/permission denied/);
  });

  it("gest_system n'a aucun accès aux données financières du foyer", async () => {
    await expect(system.bankAccount.findMany()).rejects.toThrow(/permission denied/);
    await expect(system.transaction.count()).rejects.toThrow(/permission denied/);
    await expect(system.recurringRule.count()).rejects.toThrow(/permission denied/);
    await expect(system.payslipImport.count()).rejects.toThrow(/permission denied/);
  });

  it("gest_system peut écrire l'audit mais pas le relire ni le modifier", async () => {
    await system.auditLog.createMany({ data: [{ householdId: a, action: "test" }] });
    expect(await admin.auditLog.count({ where: { action: "test" } })).toBe(1);
    await expect(system.auditLog.findMany()).rejects.toThrow(/permission denied/);
    await expect(system.auditLog.deleteMany()).rejects.toThrow(/permission denied/);
  });

  it("les rôles de l'API ne sont ni super-utilisateurs ni propriétaires des tables", async () => {
    const rows = await admin.$queryRaw<{ rolname: string; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean }[]>`
      SELECT rolname::text, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname IN ('gest_app', 'gest_system') ORDER BY rolname`;
    expect(rows).toEqual([
      { rolname: "gest_app", rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false },
      { rolname: "gest_system", rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: true },
    ]);
    const owners = await admin.$queryRaw<{ owner: string }[]>`SELECT DISTINCT tableowner::text AS owner FROM pg_tables WHERE schemaname = 'public'`;
    expect(owners.map((o) => o.owner)).not.toContain("gest_app");
    expect(owners.map((o) => o.owner)).not.toContain("gest_system");
  });
});
