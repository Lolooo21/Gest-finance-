import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BudgetQuery, CategoryDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CategoriesService } from "./categories.service.js";

const firstOfMonth = () => toDate(`${toIso(new Date()).slice(0, 7)}-01`);

/** Un nom déjà pris dans le foyer : message clair plutôt qu'une erreur 500. */
function duplicateName(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Une catégorie porte déjà ce nom");
  throw e;
}

/**
 * Catégories de dépenses et budgets mensuels (enveloppes) : alerte à 80 % puis à 100 % du plafond, report optionnel du reliquat.
 * Supprimer une catégorie laisse ses opérations et récurrences sans catégorie.
 */
@Controller("categories")
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
  ) {}

  /** Catégories avec leurs dépenses et l'état de leur budget pour `month` (mois en cours par défaut). */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(BudgetQuery)) q: BudgetQuery) {
    return this.categories.budgets(user.householdId, q.month ?? toIso(new Date()).slice(0, 7));
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CategoryDto)) dto: CategoryDto) {
    const category = await this.prisma.category
      .create({
        data: { householdId: user.householdId, name: dto.name, monthlyBudgetCents: dto.monthlyBudgetCents, rollover: dto.rollover, budgetSince: dto.monthlyBudgetCents ? firstOfMonth() : null },
      })
      .catch(duplicateName);
    await this.audit.record(user.householdId, user.userId, "category.created");
    return { id: category.id };
  }

  /** Le reliquat se compte à partir du mois où le budget est fixé : en ajouter un ne réécrit pas les mois passés. */
  @Put(":id")
  @Roles("OWNER", "ADULT")
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(CategoryDto)) dto: CategoryDto) {
    const current = await this.prisma.category.findFirst({ where: { id, householdId: user.householdId } });
    if (!current) throw new NotFoundException();
    const budgetSince = !dto.monthlyBudgetCents ? null : (current.budgetSince ?? firstOfMonth());
    await this.prisma.category
      .update({ where: { id }, data: { name: dto.name, monthlyBudgetCents: dto.monthlyBudgetCents, rollover: dto.rollover, budgetSince } })
      .catch(duplicateName);
    await this.audit.record(user.householdId, user.userId, "category.updated");
    return { ok: true };
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.category.deleteMany({ where: { id, householdId: user.householdId } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "category.deleted");
  }
}
