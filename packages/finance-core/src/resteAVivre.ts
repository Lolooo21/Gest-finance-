import { occurrences, type RecurringRule } from "./recurrence.js";

export interface OneOffTransaction {
  /** Date ISO YYYY-MM-DD. */
  date: string;
  amountCents: number;
}

export interface ResteAVivre {
  incomeCents: number;
  fixedChargesCents: number;
  oneOffExpensesCents: number;
  /** Revenus attendus − charges fixes − dépenses ponctuelles (centimes). */
  remainingCents: number;
}

/**
 * Reste à vivre sur la période [from, to] :
 * revenus (récurrents + ponctuels) − charges récurrentes − dépenses ponctuelles.
 * Fonction pure : à rappeler à chaque ajout/modification d'une entrée ou sortie.
 */
export function resteAVivre(
  from: string,
  to: string,
  rules: RecurringRule[],
  oneOffs: OneOffTransaction[],
): ResteAVivre {
  let income = 0;
  let fixed = 0;
  let oneOffExpenses = 0;

  for (const rule of rules) {
    const total = occurrences(rule, from, to).length * rule.amountCents;
    if (total >= 0) income += total;
    else fixed += -total;
  }
  for (const t of oneOffs) {
    if (t.date < from || t.date > to) continue;
    if (t.amountCents >= 0) income += t.amountCents;
    else oneOffExpenses += -t.amountCents;
  }

  return {
    incomeCents: income,
    fixedChargesCents: fixed,
    oneOffExpensesCents: oneOffExpenses,
    remainingCents: income - fixed - oneOffExpenses,
  };
}
