import { Injectable } from "@nestjs/common";
import { detectRuleDrifts, detectSubscriptions, type ExistingRule, type HistoryTransaction } from "@gest-finance/finance-core";
import { toDate, toIso } from "../common/dates.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Historique analysé : un peu plus d'un an, pour reconnaître aussi les échéances annuelles. */
const HISTORY_DAYS = 400;

export const driftKey = (ruleId: string, transactionId: string) => `drift|${ruleId}|${transactionId}`;

/** Abonnements détectés et écarts de prix, partagés par la page des abonnements et le bilan de la semaine. */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async load(householdId: string, today = toIso(new Date())) {
    const since = toDate(toIso(new Date(toDate(today).getTime() - HISTORY_DAYS * 86_400_000)));
    const [txRows, ruleRows] = await Promise.all([
      this.prisma.transaction.findMany({ where: { householdId, date: { gte: since } }, orderBy: { date: "asc" } }),
      this.prisma.recurringRule.findMany({ where: { householdId } }),
    ]);
    const transactions: HistoryTransaction[] = txRows.map((t) => ({
      id: t.id, accountId: t.accountId, date: toIso(t.date), amountCents: t.amountCents, label: t.label, categoryId: t.categoryId,
    }));
    const rules: (ExistingRule & { categoryId: string | null; end?: string })[] = ruleRows.map((r) => ({
      id: r.id, accountId: r.accountId, label: r.label, amountCents: r.amountCents, frequency: r.frequency,
      start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}), categoryId: r.categoryId,
    }));
    return { today, transactions, rules };
  }

  /** Propositions non ignorées : abonnements sans récurrence et récurrences dont le prix réel a changé. */
  async overview(householdId: string, today?: string) {
    const data = await this.load(householdId, today);
    const dismissed = new Set((await this.prisma.subscriptionDismissal.findMany({ where: { householdId }, select: { key: true } })).map((d) => d.key));
    const candidates = detectSubscriptions(data.transactions, data.rules, data.today).filter((c) => !dismissed.has(c.key));
    const drifts = detectRuleDrifts(data.transactions, data.rules, data.today)
      .map((d) => ({ ...d, key: driftKey(d.ruleId, d.transactionId) }))
      .filter((d) => !dismissed.has(d.key));
    return { candidates, drifts, dismissed: dismissed.size };
  }
}
