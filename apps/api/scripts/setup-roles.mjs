// Pose les mots de passe des rôles `gest_app` et `gest_system` (créés sans mot de passe par la migration `rls_foyer`).
// Les mots de passe viennent des URL de connexion : une seule source de vérité, jamais écrite dans une migration.
// Exécuté avec les droits du propriétaire (DATABASE_OWNER_URL) après `prisma migrate deploy`, de façon idempotente.
import { PrismaClient } from "@prisma/client";

const ROLES = [
  { role: "gest_app", env: "DATABASE_URL" },
  { role: "gest_system", env: "DATABASE_SYSTEM_URL" },
];

function passwordOf({ role, env }) {
  const raw = process.env[env];
  if (!raw) throw new Error(`${env} est requis`);
  const url = new URL(raw);
  if (decodeURIComponent(url.username) !== role) throw new Error(`${env} doit utiliser le rôle « ${role} »`);
  const password = decodeURIComponent(url.password);
  if (password.length < 16) throw new Error(`Le mot de passe de ${role} doit faire au moins 16 caractères`);
  return password;
}

const owner = process.env.DATABASE_OWNER_URL;
if (!owner) throw new Error("DATABASE_OWNER_URL est requis");
const prisma = new PrismaClient({ datasourceUrl: owner });
try {
  for (const r of ROLES) {
    const password = passwordOf(r).replaceAll("'", "''");
    await prisma.$executeRawUnsafe(`ALTER ROLE ${r.role} PASSWORD '${password}'`);
    console.log(`Mot de passe de ${r.role} appliqué`);
  }
} finally {
  await prisma.$disconnect();
}
