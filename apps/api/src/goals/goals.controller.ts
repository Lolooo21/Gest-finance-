import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Put, UseGuards } from "@nestjs/common";
import { BehaviorGoalDto, BehaviorKind } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { GoalsService } from "./goals.service.js";

@Controller("goals")
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly goals: GoalsService,
  ) {}

  /** Objectifs de comportement du foyer avec leur statut du mois en cours, l'historique (12 mois maximum) et la série de mois réussis. */
  @Get("behavior")
  list(@CurrentUser() user: AuthUser) {
    return this.goals.behavior(user.householdId);
  }

  /** Active un objectif ou modifie son plafond. Le plafond n'a de sens que pour « dépenses sous un plafond ». */
  @Put("behavior/:kind")
  @Roles("OWNER", "ADULT")
  async set(
    @CurrentUser() user: AuthUser,
    @Param("kind", new ZodPipe(BehaviorKind)) kind: BehaviorKind,
    @Body(new ZodPipe(BehaviorGoalDto)) dto: BehaviorGoalDto,
  ) {
    if (kind === "SPENDING_CAP" && !dto.capCents) throw new BadRequestException("Indiquez le plafond de dépenses du mois");
    if (kind !== "SPENDING_CAP" && dto.capCents !== undefined) throw new BadRequestException("Ce type d'objectif n'a pas de plafond");
    const capCents = kind === "SPENDING_CAP" ? dto.capCents! : null;
    await this.prisma.behaviorGoal.upsert({
      where: { householdId_kind: { householdId: user.householdId, kind } },
      update: { capCents },
      create: { householdId: user.householdId, kind, capCents },
    });
    await this.audit.record(user.householdId, user.userId, `goal.behavior_set:${kind}`);
    return { ok: true };
  }

  @Delete("behavior/:kind")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("kind", new ZodPipe(BehaviorKind)) kind: BehaviorKind) {
    const { count } = await this.prisma.behaviorGoal.deleteMany({ where: { householdId: user.householdId, kind } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, `goal.behavior_removed:${kind}`);
  }
}
