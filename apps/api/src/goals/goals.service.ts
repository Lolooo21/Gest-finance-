import { Injectable } from "@nestjs/common";
import { averageMonthlyExpenses, emergencyFund, evaluateBehaviorGoal, evaluateSavingsGoal, lastDay, resteAVivre } from "@gest-finance/finance-core";
import { toIso } from "../common/dates.js";
import { loadHouseholdFinance } from "../common/finance-data.js";
import { PrismaService } from "../prisma/prisma.service.js";

const RECENT_CONTRIBUTIONS = 10;

/** Évaluation des objectifs du foyer, partagée par les pages d'objectifs et le bilan de la semaine. */
@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Objectifs de comportement avec statut du mois en cours, historique (12 mois maximum) et série de mois réussis. */
  async behavior(householdId: string) {
    const goals = await this.prisma.behaviorGoal.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } });
    if (goals.length === 0) return [];
    const data = { ...(await loadHouseholdFinance(this.prisma, householdId)), today: toIso(new Date()) };
    return goals.map((g) => ({
      ...evaluateBehaviorGoal({ kind: g.kind, ...(g.capCents ? { capCents: g.capCents } : {}), since: toIso(g.createdAt).slice(0, 7) }, data),
      since: toIso(g.createdAt),
    }));
  }

  /**
   * Objectifs d'épargne : avancement (somme des versements), versement mensuel conseillé, épargne de secours (3 à 6 mois de dépenses
   * habituelles) et reste à vivre du mois comme plafond raisonnable de ce qu'on peut mettre de côté.
   */
  async savings(householdId: string) {
    const today = toIso(new Date());
    const [goals, sums, finance, accounts] = await Promise.all([
      this.prisma.savingsGoal.findMany({
        where: { householdId },
        orderBy: { createdAt: "asc" },
        include: { contributions: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: RECENT_CONTRIBUTIONS } },
      }),
      this.prisma.savingsContribution.groupBy({ by: ["goalId"], where: { householdId }, _sum: { amountCents: true } }),
      loadHouseholdFinance(this.prisma, householdId),
      this.prisma.bankAccount.findMany({ where: { householdId }, select: { id: true, name: true } }),
    ]);
    const saved = new Map(sums.map((s) => [s.goalId, s._sum.amountCents ?? 0]));
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));

    const views = goals.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      targetDate: g.targetDate ? toIso(g.targetDate) : null,
      accountId: g.accountId,
      account: g.accountId ? (accountName.get(g.accountId) ?? null) : null,
      annualRateBp: g.annualRateBp,
      ...evaluateSavingsGoal(
        { kind: g.kind, targetCents: g.targetCents, targetDate: g.targetDate ? toIso(g.targetDate) : null, createdOn: toIso(g.createdAt), annualRateBp: g.annualRateBp },
        saved.get(g.id) ?? 0,
        today,
      ),
      contributions: g.contributions.map((c) => ({ id: c.id, date: toIso(c.date), amountCents: c.amountCents, note: c.note })),
    }));

    const emergencySaved = views.filter((v) => v.kind === "EMERGENCY").reduce((acc, v) => acc + v.savedCents, 0);
    const month = today.slice(0, 7);
    const rav = resteAVivre(`${month}-01`, lastDay(month), finance.rules, finance.oneOffs.map((t) => ({ date: t.date, amountCents: t.amountCents })));
    return {
      goals: views,
      emergency: emergencyFund(averageMonthlyExpenses(today, finance.rules, finance.oneOffs), emergencySaved),
      /** Ce qui reste à vivre ce mois-ci (jamais négatif). */
      capacityCents: Math.max(0, rav.remainingCents),
      totalAdvisedCents: views.reduce((acc, v) => acc + (v.status === "ACHIEVED" ? 0 : (v.advisedMonthlyCents ?? 0)), 0),
    };
  }
}
