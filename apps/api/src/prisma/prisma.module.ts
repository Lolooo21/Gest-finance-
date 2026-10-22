import { Global, Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createAppClient, createSystemClient, PrismaConnections, PrismaService, scopeClient, SystemPrismaService } from "./prisma.service.js";

const APP = Symbol("PRISMA_APP");
const SYSTEM = Symbol("PRISMA_SYSTEM");

@Global()
@Module({
  providers: [
    { provide: APP, useFactory: createAppClient },
    { provide: SYSTEM, useFactory: createSystemClient },
    { provide: PrismaService, useFactory: (app: PrismaClient) => scopeClient(app), inject: [APP] },
    { provide: SystemPrismaService, useExisting: SYSTEM },
    { provide: PrismaConnections, useFactory: (app: PrismaClient, system: PrismaClient, scoped: PrismaService) => new PrismaConnections(app, system, scoped), inject: [APP, SYSTEM, PrismaService] },
  ],
  exports: [PrismaService, SystemPrismaService],
})
export class PrismaModule {}
