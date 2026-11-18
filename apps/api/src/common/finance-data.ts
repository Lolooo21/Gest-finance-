import type { ForecastOneOff, ForecastRule, GoalAccount } from "@gest-finance/finance-core";
import type { AccountScope } from "@gest-finance/shared";
import { toIso } from "./dates.js";
import type { PrismaService } from "../prisma/prisma.service.js";

export interface HouseholdFinance {
  accounts: (GoalAccount & { name: string })[];
  rules: ForecastRule[];
  oneOffs: ForecastOneOff[];
}

/**
 * Filtre Prisma d'une vue sur les comptes : tous les comptes visibles, les joints seulement ou mes comptes personnels seulement.
 * La RLS écarte déjà les comptes personnels des autres membres ; ce filtre ne fait que restreindre la vue.
 */
export function ownerFilter(scope: AccountScope, userId: string): { ownerId?: string | null } {
  if (scope === "joint") return { ownerId: null };
  if (scope === "personal") return { ownerId: userId };
  return {};
}

/** Même filtre, pour les lignes rattachées à un compte (opérations, règles récurrentes). */
export const accountFilter = (scope: AccountScope, userId: string) => (scope === "all" ? {} : { account: ownerFilter(scope, userId) });

/** Comptes, règles récurrentes et opérations du foyer courant (la RLS limite déjà à ce foyer ; le filtre reste explicite), restreints à une vue. */
export async function loadHouseholdFinance(prisma: PrismaService, householdId: string, view?: { scope: AccountScope; userId: string }): Promise<HouseholdFinance> {
  const byAccount = view ? accountFilter(view.scope, view.userId) : {};
  const [accounts, rules, transactions] = await Promise.all([
    prisma.bankAccount.findMany({ where: { householdId, ...(view ? ownerFilter(view.scope, view.userId) : {}) }, orderBy: { createdAt: "asc" } }),
    prisma.recurringRule.findMany({ where: { householdId, ...byAccount } }),
    prisma.transaction.findMany({ where: { householdId, ...byAccount } }),
  ]);
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, initialCents: a.initialBalanceCents })),
    rules: rules.map((r) => ({
      id: r.id, accountId: r.accountId, label: r.label, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}),
    })),
    oneOffs: transactions.map((t) => ({ accountId: t.accountId, date: toIso(t.date), amountCents: t.amountCents, label: t.label })),
  };
}
