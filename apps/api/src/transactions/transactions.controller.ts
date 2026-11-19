import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { installmentPlan } from "@gest-finance/finance-core";
import { InstallmentsDto, TransactionDto, TransactionPatch } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { CategorizerService } from "../categories/categorizer.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

const view = (t: { id: string; accountId: string; amountCents: number; date: Date; label: string; categoryId: string | null }) => ({
  id: t.id, accountId: t.accountId, amountCents: t.amountCents, date: toIso(t.date), label: t.label, categoryId: t.categoryId,
});

@Controller("transactions")
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categorizer: CategorizerService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = await this.prisma.transaction.findMany({ where: { householdId: user.householdId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take });
    return rows.map(view);
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TransactionDto)) dto: TransactionDto) {
    // Le compte référencé doit appartenir au foyer du jeton (sinon IDOR via accountId).
    const account = await this.prisma.bankAccount.findFirst({ where: { id: dto.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");
    // Sans catégorie indiquée : proposition automatique ; un choix explicite est appris.
    const categoryId = await this.categorizer.resolve(user.householdId, dto.label, dto.categoryId);
    const t = await this.prisma.transaction.create({
      data: { householdId: user.householdId, accountId: dto.accountId, amountCents: dto.amountCents, date: toDate(dto.date), label: dto.label, categoryId },
    });
    await this.audit.record(user.householdId, user.userId, "transaction.created");
    return view(t);
  }

  /**
   * Paiement en plusieurs fois : une opération par échéance mensuelle (« Libellé (1/4) »…), créées ensemble. Chaque échéance compte
   * dans le solde à sa date, apparaît dans le prévisionnel et se modifie ou se supprime comme une opération ordinaire.
   */
  @Post("installments")
  @Roles("OWNER", "ADULT")
  async createInstallments(@CurrentUser() user: AuthUser, @Body(new ZodPipe(InstallmentsDto)) dto: InstallmentsDto) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: dto.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");
    const categoryId = await this.categorizer.resolve(user.householdId, dto.label, dto.categoryId);
    const plan = installmentPlan(dto.amountCents, dto.count, dto.date);
    await this.prisma.transaction.createMany({
      data: plan.map((p) => ({
        householdId: user.householdId, accountId: dto.accountId, amountCents: p.amountCents, date: toDate(p.date),
        label: `${dto.label.slice(0, 110)} (${p.index}/${dto.count})`, categoryId,
      })),
    });
    await this.audit.record(user.householdId, user.userId, "transaction.installments");
    return { count: plan.length, installments: plan };
  }

  @Patch(":id")
  @Roles("OWNER", "ADULT")
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(TransactionPatch)) dto: TransactionPatch) {
    const { date, ...fields } = dto;
    const current = await this.prisma.transaction.findFirst({ where: { id, householdId: user.householdId }, select: { label: true } });
    if (!current) throw new NotFoundException();
    // Reclasser une opération est une correction : elle est apprise (null = retirer la catégorie, rien à apprendre).
    if (dto.categoryId) await this.categorizer.resolve(user.householdId, dto.label ?? current.label, dto.categoryId);
    const { count } = await this.prisma.transaction.updateMany({
      where: { id, householdId: user.householdId },
      data: { ...fields, ...(date ? { date: toDate(date) } : {}) },
    });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "transaction.updated");
    return { ok: true };
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.transaction.deleteMany({ where: { id, householdId: user.householdId } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "transaction.deleted");
  }
}
