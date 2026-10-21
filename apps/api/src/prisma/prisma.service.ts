import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Accès à la base à deux niveaux (voir la migration `rls_foyer`) :
 *  - `PrismaService` : rôle `gest_app`, soumis à la RLS. Chaque requête s'exécute dans une transaction qui fixe le foyer courant ;
 *    sans foyer (aucun utilisateur connecté), l'accès est REFUSÉ plutôt que silencieusement vide.
 *  - `SystemPrismaService` : rôle `gest_system`, réservé à l'inscription, la connexion, l'audit, le planificateur de rappels
 *    et les indicateurs de marché. Droits limités aux tables nécessaires.
 */

const households = new AsyncLocalStorage<{ householdId: string }>();


/**
 * Exécute `fn` dans le contexte d'un foyer : requête HTTP entière (hook Fastify de app.ts, avec le foyer d'un jeton vérifié), tests, scripts.
 * `enterWith` depuis une garde Nest ne convient pas : le contexte asynchrone se perd après un `await`.
 */
export const runInHousehold = <T>(householdId: string, fn: () => T): T => households.run({ householdId }, fn);

const noHousehold = () => new Error("Accès à la base refusé : aucun foyer dans le contexte de la requête");

export function scopeClient(base: PrismaClient) {
  const setHousehold = (client: Prisma.TransactionClient | PrismaClient, householdId: string) =>
    client.$executeRaw`SELECT set_config('app.household_id', ${householdId}, true)`;
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const ctx = households.getStore();
          if (!ctx) throw noHousehold();
          // Lot transactionnel : le foyer n'existe que le temps de la requête (set_config local à la transaction).
          const [, result] = await base.$transaction([setHousehold(base, ctx.householdId), query(args)]);
          return result;
        },
      },
    },
    client: {
      /** Transaction interactive dans le foyer courant (plusieurs écritures atomiques). */
      $householdTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        const ctx = households.getStore();
        if (!ctx) return Promise.reject(noHousehold());
        return base.$transaction(async (tx) => {
          await setHousehold(tx, ctx.householdId);
          return fn(tx);
        });
      },
    },
  });
}

export type ScopedClient = ReturnType<typeof scopeClient>;

/* La fusion classe/interface est voulue : la classe sert de jeton d'injection Nest, l'interface donne le type du client (modèles Prisma). */
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type */
/** Jeton d'injection (la classe) et type (l'interface fusionnée) du client soumis à la RLS. */
export class PrismaService {}
export interface PrismaService extends ScopedClient {}

/** Jeton d'injection et type du client « système » (hors RLS, droits limités). */
export class SystemPrismaService {}
export interface SystemPrismaService extends PrismaClient {}
/* eslint-enable @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type */

export const createAppClient = () => new PrismaClient();
export const createSystemClient = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_SYSTEM_URL });

const notMigrated = (model: string) =>
  `Base de données non migrée ou client Prisma obsolète (modèle « ${model} ») : dans apps/api, lancez \`pnpm exec prisma migrate deploy\` puis \`pnpm exec prisma generate\`, et redémarrez.`;

/** Un modèle par table : une migration oubliée est détectée au démarrage, pas à la première requête. */
const MODELS = ["user", "bankAccount", "transaction", "recurringRule", "reminderSetting", "pushSubscription", "payslipImport", "marketSnapshot", "auditLog", "refreshToken"] as const;
const SYSTEM_CHECKS = ["household", "user", "refreshToken", "reminderSetting", "pushSubscription", "marketSnapshot"] as const;

/** Possède les connexions : vérifie la configuration au démarrage et les ferme à l'arrêt. */
@Injectable()
export class PrismaConnections implements OnModuleInit, OnModuleDestroy {
  constructor(
    readonly app: PrismaClient,
    readonly system: PrismaClient,
    readonly scoped: PrismaService,
  ) {}

  async onModuleInit() {
    await this.app.$connect();
    await this.system.$connect();
    await this.assertRoles();
    // Modèle absent du client : `prisma generate` n'a pas été relancé après une mise à jour du schéma.
    for (const model of MODELS) if (!(this.app as unknown as Record<string, unknown>)[model]) throw new Error(notMigrated(model));
    for (const model of SYSTEM_CHECKS) await this.count(this.system, model);
    // Foyer fictif : la RLS renvoie 0 ligne, mais la table doit exister.
    await runInHousehold("00000000-0000-0000-0000-000000000000", async () => {
      for (const model of MODELS) await this.count(this.scoped as unknown as PrismaClient, model);
    });
  }

  async onModuleDestroy() {
    await Promise.all([this.app.$disconnect(), this.system.$disconnect()]);
  }

  /** Garde-fou : un DATABASE_URL pointant sur le propriétaire ou un super-utilisateur désactiverait la RLS sans bruit. */
  private async assertRoles() {
    const [app] = await this.app.$queryRaw<{ name: string; bypass: boolean }[]>`
      SELECT current_user::text AS name, (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`;
    if (!app || app.name !== "gest_app" || app.bypass) {
      throw new Error(
        `DATABASE_URL doit utiliser le rôle « gest_app » (sans contournement de la RLS) ; rôle actuel : « ${app?.name ?? "inconnu"} ». ` +
          "Les migrations utilisent DATABASE_OWNER_URL : voir apps/api/.env.example, puis `pnpm db:roles`.",
      );
    }
    const [sys] = await this.system.$queryRaw<{ name: string; super: boolean }[]>`
      SELECT current_user::text AS name, rolsuper AS super FROM pg_roles WHERE rolname = current_user`;
    if (!sys || sys.name !== "gest_system" || sys.super) {
      throw new Error(`DATABASE_SYSTEM_URL doit utiliser le rôle « gest_system » (non super-utilisateur) ; rôle actuel : « ${sys?.name ?? "inconnu"} ».`);
    }
  }

  private async count(client: PrismaClient, model: string) {
    const delegate = (client as unknown as Record<string, { count: () => Promise<number> } | undefined>)[model];
    if (!delegate) throw new Error(notMigrated(model));
    try {
      await delegate.count();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "P2021" || code === "P2022") throw new Error(notMigrated(model));
      throw e;
    }
  }
}
