import { addMonthsToMonth, lastDay } from "./goals.js";
import { occurrences, type RecurringRule } from "./recurrence.js";

/**
 * Enveloppes budgétaires par catégorie : plafond mensuel, alerte à 80 % puis à 100 %, report optionnel du reliquat.
 * Fonctions pures, montants en centimes, mois « AAAA-MM ». Comme le reste à vivre, un mois compte toutes ses occurrences
 * récurrentes (même celles encore à venir) : le budget mesure ce qui est déjà engagé.
 */
export type BudgetStatus = "OK" | "WARNING" | "EXCEEDED";

/** Part du plafond à partir de laquelle le budget est « à surveiller ». */
export const BUDGET_WARNING_PERCENT = 80;

export interface CategorizedRule extends RecurringRule {
  categoryId: string | null;
}

export interface CategorizedOneOff {
  date: string;
  amountCents: number;
  categoryId: string | null;
}

export interface BudgetInput {
  /** Plafond mensuel, strictement positif. */
  limitCents: number;
  /** Le reliquat (positif) d'un mois s'ajoute au plafond du mois suivant. */
  rollover: boolean;
  /** Premier mois budgété (« AAAA-MM ») : aucun reliquat n'est reporté depuis un mois antérieur. */
  since: string;
}

export interface BudgetEvaluation {
  month: string;
  limitCents: number;
  /** Reliquat reporté des mois précédents (0 sans report). */
  carryOverCents: number;
  /** Plafond du mois + reliquat reporté. */
  availableCents: number;
  spentCents: number;
  /** Disponible − dépensé (négatif en cas de dépassement). */
  remainingCents: number;
  /** Dépensé / disponible, arrondi à l'entier. */
  percent: number;
  status: BudgetStatus;
}

/**
 * Dépenses nettes d'une catégorie sur un mois : sorties moins remboursements (entrées de la même catégorie), jamais négatives.
 * `categoryId = null` mesure les opérations sans catégorie.
 */
export function categorySpent(categoryId: string | null, month: string, rules: CategorizedRule[], oneOffs: CategorizedOneOff[]): number {
  const from = `${month}-01`;
  const to = lastDay(month);
  let net = 0;
  for (const r of rules) {
    if (r.categoryId === categoryId) net += r.amountCents * occurrences(r, from, to).length;
  }
  for (const t of oneOffs) {
    if (t.categoryId === categoryId && t.date >= from && t.date <= to) net += t.amountCents;
  }
  return Math.max(0, -net);
}

/** Statut d'un budget : à surveiller dès 80 % du disponible, atteint ou dépassé à 100 %. */
export function budgetStatus(spentCents: number, availableCents: number): BudgetStatus {
  if (spentCents >= availableCents) return "EXCEEDED";
  if (spentCents * 100 >= availableCents * BUDGET_WARNING_PERCENT) return "WARNING";
  return "OK";
}

/** Évalue le budget d'une catégorie pour un mois, avec le reliquat cumulé depuis `since` si le report est activé. */
export function evaluateBudget(
  budget: BudgetInput,
  categoryId: string,
  month: string,
  rules: CategorizedRule[],
  oneOffs: CategorizedOneOff[],
): BudgetEvaluation {
  if (!(budget.limitCents > 0)) throw new RangeError("Le plafond d'un budget doit être positif");
  let carry = 0;
  if (budget.rollover) {
    for (let m = budget.since; m < month; m = addMonthsToMonth(m, 1)) {
      carry = Math.max(0, budget.limitCents + carry - categorySpent(categoryId, m, rules, oneOffs));
    }
  }
  const availableCents = budget.limitCents + carry;
  const spentCents = categorySpent(categoryId, month, rules, oneOffs);
  return {
    month,
    limitCents: budget.limitCents,
    carryOverCents: carry,
    availableCents,
    spentCents,
    remainingCents: availableCents - spentCents,
    percent: Math.round((spentCents * 100) / availableCents),
    status: budgetStatus(spentCents, availableCents),
  };
}
