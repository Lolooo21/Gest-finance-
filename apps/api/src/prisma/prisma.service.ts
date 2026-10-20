import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const NOT_MIGRATED = "Base de données non migrée ou client Prisma obsolète : dans apps/api, lancez `pnpm exec prisma migrate deploy` puis `pnpm exec prisma generate`.";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    // Diagnostic clair au démarrage plutôt qu'une erreur 500 à la première requête.
    try {
      await this.user.count();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "P2021" || code === "P2022") throw new Error(NOT_MIGRATED);
      throw e;
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
