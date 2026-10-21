import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { SavingsContributionDto, SavingsGoalDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { GoalsService } from "./goals.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Objectifs d'épargne : des enveloppes virtuelles. L'avancement est la somme des versements saisis pour l'objectif ; aucun mouvement
 * n'est fait sur un compte bancaire, et plusieurs objectifs peuvent partager un même livret.
 */
@Controller("goals/savings")
@UseGuards(AuthGuard)
export class SavingsGoalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly goals: GoalsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.goals.savings(user.householdId);
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SavingsGoalDto)) dto: SavingsGoalDto) {
    await this.assertAccount(user, dto.accountId);
    const goal = await this.prisma.savingsGoal.create({
      data: { householdId: user.householdId, name: dto.name, kind: dto.kind, targetCents: dto.targetCents, targetDate: dto.targetDate ? toDate(dto.targetDate) : null, accountId: dto.accountId, annualRateBp: dto.annualRateBp },
    });
    await this.audit.record(user.householdId, user.userId, `goal.savings_created:${dto.kind}`);
    return { id: goal.id };
  }

  @Put(":id")
  @Roles("OWNER", "ADULT")
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(SavingsGoalDto)) dto: SavingsGoalDto) {
    await this.assertAccount(user, dto.accountId);
    const { count } = await this.prisma.savingsGoal.updateMany({
      where: { id, householdId: user.householdId },
      data: { name: dto.name, kind: dto.kind, targetCents: dto.targetCents, targetDate: dto.targetDate ? toDate(dto.targetDate) : null, accountId: dto.accountId, annualRateBp: dto.annualRateBp },
    });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "goal.savings_updated");
    return { ok: true };
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.savingsGoal.deleteMany({ where: { id, householdId: user.householdId } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "goal.savings_deleted");
  }

  @Post(":id/contributions")
  @Roles("OWNER", "ADULT")
  async contribute(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(SavingsContributionDto)) dto: SavingsContributionDto) {
    const created = await this.prisma.$householdTransaction(async (tx) => {
      if (!(await tx.savingsGoal.findFirst({ where: { id, householdId: user.householdId }, select: { id: true } }))) throw new NotFoundException();
      const total = (await tx.savingsContribution.aggregate({ where: { goalId: id }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
      if (total + dto.amountCents < 0) throw new BadRequestException("Le retrait dépasse l'épargne de cet objectif");
      return tx.savingsContribution.create({ data: { householdId: user.householdId, goalId: id, amountCents: dto.amountCents, date: toDate(dto.date), note: dto.note ?? null } });
    });
    await this.audit.record(user.householdId, user.userId, "goal.savings_contribution");
    return { id: created.id };
  }

  @Delete(":id/contributions/:contributionId")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async removeContribution(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Param("contributionId", ParseUUIDPipe) contributionId: string) {
    await this.prisma.$householdTransaction(async (tx) => {
      const contribution = await tx.savingsContribution.findFirst({ where: { id: contributionId, goalId: id, householdId: user.householdId } });
      if (!contribution) throw new NotFoundException();
      const total = (await tx.savingsContribution.aggregate({ where: { goalId: id }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
      if (total - contribution.amountCents < 0) throw new BadRequestException("Supprimer ce versement rendrait l'épargne de l'objectif négative");
      await tx.savingsContribution.delete({ where: { id: contributionId } });
    });
    await this.audit.record(user.householdId, user.userId, "goal.savings_contribution_removed");
  }

  private async assertAccount(user: AuthUser, accountId: string | null) {
    if (accountId && !(await this.prisma.bankAccount.findFirst({ where: { id: accountId, householdId: user.householdId }, select: { id: true } }))) {
      throw new BadRequestException("Compte introuvable");
    }
  }
}
