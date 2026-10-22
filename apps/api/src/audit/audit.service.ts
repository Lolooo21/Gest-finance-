import { Injectable } from "@nestjs/common";
import { SystemPrismaService } from "../prisma/prisma.service.js";

/** Journal d'audit : actions uniquement, jamais de données financières ni de secrets. Écriture seule (rôle système) : l'API ne peut pas modifier le journal. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: SystemPrismaService) {}

  record(householdId: string, userId: string | null, action: string) {
    // createMany : pas de RETURNING, le rôle système n'a pas le droit de relire le journal.
    return this.prisma.auditLog.createMany({ data: [{ householdId, userId, action }] });
  }
}
