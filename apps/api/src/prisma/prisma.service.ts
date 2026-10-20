import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/** Un modèle par table : une migration oubliée est détectée au démarrage, pas à la première requête. */
const MODELS = ["user", "bankAccount", "transaction", "recurringRule", "reminderSetting", "pushSubscription", "payslipImport", "marketSnapshot"] as const;

const notMigrated = (model: string) =>
  `Base de données non migrée ou client Prisma obsolète (modèle « ${model} ») : dans apps/api, lancez \`pnpm exec prisma migrate deploy\` puis \`pnpm exec prisma generate\`, et redémarrez.`;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    for (const model of MODELS) {
      // Modèle absent du client : `prisma generate` n'a pas été relancé après une mise à jour du schéma.
      const delegate = this[model] as { count: () => Promise<number> } | undefined;
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
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
