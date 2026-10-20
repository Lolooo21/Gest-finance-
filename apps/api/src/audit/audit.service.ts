import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Journal d'audit : actions uniquement, jamais de données financières ni de secrets. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(householdId: string, userId: string | null, action: string) {
    return this.prisma.auditLog.create({ data: { householdId, userId, action } });
  }
}
