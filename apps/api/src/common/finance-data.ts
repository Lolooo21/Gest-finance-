import type { ForecastOneOff, ForecastRule, GoalAccount } from "@gest-finance/finance-core";
import { toIso } from "./dates.js";
import type { PrismaService } from "../prisma/prisma.service.js";

export interface HouseholdFinance {
  accounts: (GoalAccount & { name: string })[];
  rules: ForecastRule[];
  oneOffs: ForecastOneOff[];
}

/** Comptes, règles récurrentes et opérations du foyer courant (la RLS limite déjà à ce foyer ; le filtre reste explicite). */
export async function loadHouseholdFinance(prisma: PrismaService, householdId: string): Promise<HouseholdFinance> {
  const [accounts, rules, transactions] = await Promise.all([
    prisma.bankAccount.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } }),
    prisma.recurringRule.findMany({ where: { householdId } }),
    prisma.transaction.findMany({ where: { householdId } }),
  ]);
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, initialCents: a.initialBalanceCents })),
    rules: rules.map((r) => ({
      id: r.id, accountId: r.accountId, label: r.label, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}),
    })),
    oneOffs: transactions.map((t) => ({ accountId: t.accountId, date: toIso(t.date), amountCents: t.amountCents, label: t.label })),
  };
}
