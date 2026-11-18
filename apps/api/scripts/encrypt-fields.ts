/**
 * Chiffre les champs texte sensibles encore en clair (données d'avant le chiffrement des champs) : libellés des opérations et des
 * récurrences, employeur des fiches de paie, note des versements d'épargne. Sans effet sur une valeur déjà chiffrée : peut être relancé.
 *
 * Lancé par le service `migrate` au déploiement (et par `pnpm dev` / `pnpm test`), avec le rôle propriétaire (hors RLS) :
 *   node --import @swc-node/register/esm-register scripts/encrypt-fields.ts
 * Variables : DATABASE_OWNER_URL, FIELD_ENCRYPTION_KEY.
 */
import { PrismaClient } from "@prisma/client";
import { FieldCipher } from "../src/crypto/field-cipher.js";

const BATCH = 500;

interface Row { id: string; value: string }

/** Une table et sa colonne : lecture d'un lot en clair, écriture d'une valeur chiffrée (requêtes paramétrées, aucun SQL dynamique). */
interface Target { name: string; read: (db: PrismaClient) => Promise<Row[]>; write: (db: PrismaClient, id: string, value: string) => Promise<number> }

const TARGETS: Target[] = [
  {
    name: "Transaction.label",
    read: (db) => db.$queryRaw<Row[]>`SELECT id, label AS value FROM "Transaction" WHERE label NOT LIKE 'enc1:%' LIMIT ${BATCH}`,
    write: (db, id, value) => db.$executeRaw`UPDATE "Transaction" SET label = ${value} WHERE id = ${id}`,
  },
  {
    name: "RecurringRule.label",
    read: (db) => db.$queryRaw<Row[]>`SELECT id, label AS value FROM "RecurringRule" WHERE label NOT LIKE 'enc1:%' LIMIT ${BATCH}`,
    write: (db, id, value) => db.$executeRaw`UPDATE "RecurringRule" SET label = ${value} WHERE id = ${id}`,
  },
  {
    name: "PayslipImport.employer",
    read: (db) => db.$queryRaw<Row[]>`SELECT id, employer AS value FROM "PayslipImport" WHERE employer IS NOT NULL AND employer NOT LIKE 'enc1:%' LIMIT ${BATCH}`,
    write: (db, id, value) => db.$executeRaw`UPDATE "PayslipImport" SET employer = ${value} WHERE id = ${id}`,
  },
  {
    name: "SavingsContribution.note",
    read: (db) => db.$queryRaw<Row[]>`SELECT id, note AS value FROM "SavingsContribution" WHERE note IS NOT NULL AND note NOT LIKE 'enc1:%' LIMIT ${BATCH}`,
    write: (db, id, value) => db.$executeRaw`UPDATE "SavingsContribution" SET note = ${value} WHERE id = ${id}`,
  },
];

export async function encryptExistingFields(db: PrismaClient, cipher = new FieldCipher()): Promise<Record<string, number>> {
  const done: Record<string, number> = {};
  for (const target of TARGETS) {
    let count = 0;
    for (;;) {
      const rows = await target.read(db);
      if (rows.length === 0) break;
      await db.$transaction(async (tx) => {
        for (const row of rows) await target.write(tx as PrismaClient, row.id, cipher.encryptField(row.value));
      });
      count += rows.length;
    }
    done[target.name] = count;
  }
  return done;
}

// Lancement direct (et non import par un test).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/encrypt-fields.ts")) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error("DATABASE_OWNER_URL manquant : ce script utilise le rôle propriétaire (migrations).");
    process.exit(1);
  }
  const db = new PrismaClient({ datasourceUrl: url });
  encryptExistingFields(db)
    .then((done) => {
      const total = Object.values(done).reduce((s, n) => s + n, 0);
      console.log(total ? `Champs chiffrés : ${Object.entries(done).map(([k, n]) => `${k} ${n}`).join(", ")}` : "Champs sensibles : déjà tous chiffrés.");
    })
    .catch((e: unknown) => {
      console.error(`Chiffrement des champs en échec : ${e instanceof Error ? e.message : "erreur inconnue"}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
