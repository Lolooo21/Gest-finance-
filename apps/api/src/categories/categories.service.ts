import { BadRequestException, Injectable } from "@nestjs/common";
import type { AccountScope } from "@gest-finance/shared";
import { categorySpent, evaluateBudget, type CategorizedOneOff, type CategorizedRule } from "@gest-finance/finance-core";
import { toIso } from "../common/dates.js";
import { accountFilter } from "../common/finance-data.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Catégories et budgets du foyer, partagés par la page des budgets et le bilan de la semaine. */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Refuse une catégorie d'un autre foyer (IDOR via categoryId) ; `null` ou absente = sans catégorie. */
  async assertCategory(householdId: string, categoryId: string | null | undefined) {
    if (categoryId && !(await this.prisma.category.findFirst({ where: { id: categoryId, householdId }, select: { id: true } }))) {
      throw new BadRequestException("Catégorie introuvable");
    }
  }

  /**
   * Dépenses du mois par catégorie, état de chaque budget (avec reliquat reporté) et dépenses sans catégorie.
   * Les plafonds sont ceux du foyer ; `view` ne compte que les dépenses des comptes joints ou de mes comptes personnels.
   */
  async budgets(householdId: string, month: string, view?: { scope: AccountScope; userId: string }) {
    const byAccount = view ? accountFilter(view.scope, view.userId) : {};
    const [categories, ruleRows, txRows] = await Promise.all([
      this.prisma.category.findMany({ where: { householdId }, orderBy: { name: "asc" } }),
      this.prisma.recurringRule.findMany({ where: { householdId, ...byAccount } }),
      this.prisma.transaction.findMany({ where: { householdId, ...byAccount }, select: { date: true, amountCents: true, categoryId: true } }),
    ]);
    const rules: CategorizedRule[] = ruleRows.map((r) => ({
      id: r.id, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}), categoryId: r.categoryId,
    }));
    const oneOffs: CategorizedOneOff[] = txRows.map((t) => ({ date: toIso(t.date), amountCents: t.amountCents, categoryId: t.categoryId }));

    const views = categories.map((c) => ({
      id: c.id,
      name: c.name,
      monthlyBudgetCents: c.monthlyBudgetCents,
      rollover: c.rollover,
      spentCents: categorySpent(c.id, month, rules, oneOffs),
      // Un budget créé après le mois consulté n'a pas encore d'effet sur ce mois.
      budget: c.monthlyBudgetCents && c.budgetSince && toIso(c.budgetSince).slice(0, 7) <= month
        ? evaluateBudget({ limitCents: c.monthlyBudgetCents, rollover: c.rollover, since: toIso(c.budgetSince).slice(0, 7) }, c.id, month, rules, oneOffs)
        : null,
    }));
    const budgeted = views.flatMap((v) => (v.budget ? [v.budget] : []));
    return {
      month,
      scope: view?.scope ?? "all",
      categories: views,
      uncategorizedSpentCents: categorySpent(null, month, rules, oneOffs),
      totals: {
        availableCents: budgeted.reduce((s, b) => s + b.availableCents, 0),
        spentCents: budgeted.reduce((s, b) => s + b.spentCents, 0),
      },
    };
  }
}
