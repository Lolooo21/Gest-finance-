import { accountBalanceAt, addDays, dailyBalances, flowsBetween, type AccountKind, type ForecastOneOff, type ForecastRule } from "./forecast.js";
import { resteAVivre } from "./resteAVivre.js";

/**
 * Objectifs de comportement mensuels, évalués sur les données réelles (règles récurrentes + opérations datées).
 * Fonctions pures, montants en centimes, mois « AAAA-MM ».
 */
export type BehaviorKind = "NO_OVERDRAFT" | "POSITIVE_REMAINING" | "SPENDING_CAP";

/** ACHIEVED / FAILED : mois terminé. ON_TRACK / AT_RISK / FAILED : mois en cours (FAILED = déjà raté, sans retour possible). */
export type GoalStatus = "ACHIEVED" | "FAILED" | "ON_TRACK" | "AT_RISK";

export interface BehaviorGoalInput {
  kind: BehaviorKind;
  /** Plafond de dépenses du mois (SPENDING_CAP uniquement). */
  capCents?: number;
  /** Premier mois évalué (« AAAA-MM »), en général le mois de création de l'objectif. */
  since: string;
}

export interface GoalAccount {
  id: string;
  type: AccountKind;
  initialCents: number;
}

export interface MonthEvaluation {
  month: string;
  status: GoalStatus;
  /** Mesure du mois : solde le plus bas (NO_OVERDRAFT), reste à vivre (POSITIVE_REMAINING) ou dépenses (SPENDING_CAP). */
  valueCents: number;
  /** Seuil comparé (0 pour le solde et le reste à vivre, plafond pour les dépenses). */
  limitCents: number;
}

export interface GoalEvaluation {
  kind: BehaviorKind;
  capCents: number | null;
  current: MonthEvaluation;
  /** Mois terminés depuis la création (au plus 12), du plus ancien au plus récent. */
  history: MonthEvaluation[];
  /** Mois terminés réussis d'affilée, jusqu'au dernier mois terminé. */
  streak: number;
}

/** Part du plafond à partir de laquelle le mois est « à risque » (alerte à 80 %). */
export const CAP_WARNING_PERCENT = 80;
/** En dessous de ce pourcentage des revenus, le reste à vivre est « à risque ». */
export const REMAINING_WARNING_PERCENT = 10;

const monthOf = (iso: string) => iso.slice(0, 7);
const firstDay = (month: string) => `${month}-01`;
export const lastDay = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const addMonthsToMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

interface Data {
  today: string;
  accounts: GoalAccount[];
  rules: ForecastRule[];
  oneOffs: ForecastOneOff[];
}

/** Évalue un mois ; `today` détermine s'il est terminé (avant ce mois), en cours (ce mois) ou à venir (non évalué ici). */
export function evaluateMonth(goal: Pick<BehaviorGoalInput, "kind" | "capCents">, month: string, data: Data): MonthEvaluation {
  const from = firstDay(month);
  const to = lastDay(month);
  const completed = to < data.today;
  const flows = flowsBetween(from, to, data.rules, data.oneOffs);

  if (goal.kind === "NO_OVERDRAFT") {
    const checking = data.accounts.filter((a) => a.type === "CHECKING");
    const dayBefore = addDays(from, -1);
    const opening = Object.fromEntries(
      checking.map((a) => [
        a.id,
        accountBalanceAt(dayBefore, a.initialCents, data.rules.filter((r) => r.accountId === a.id), data.oneOffs.filter((t) => t.accountId === a.id)),
      ]),
    );
    const series = dailyBalances(from, to, opening, flows.filter((e) => e.accountId in opening));
    let lowest = Number.POSITIVE_INFINITY;
    let overdrawnSoFar = false;
    let overdrawnLater = false;
    for (const day of series) {
      for (const v of Object.values(day.byAccount)) {
        lowest = Math.min(lowest, v);
        if (v < 0) {
          if (day.date <= data.today) overdrawnSoFar = true;
          else overdrawnLater = true;
        }
      }
    }
    if (!Number.isFinite(lowest)) lowest = 0;
    const status: GoalStatus = completed
      ? overdrawnSoFar || overdrawnLater ? "FAILED" : "ACHIEVED"
      : overdrawnSoFar ? "FAILED" : overdrawnLater ? "AT_RISK" : "ON_TRACK";
    return { month, status, valueCents: lowest, limitCents: 0 };
  }

  const oneOffs = data.oneOffs.map((t) => ({ date: t.date, amountCents: t.amountCents }));
  const rav = resteAVivre(from, to, data.rules, oneOffs);

  if (goal.kind === "POSITIVE_REMAINING") {
    const margin = (rav.incomeCents * REMAINING_WARNING_PERCENT) / 100;
    const status: GoalStatus = completed
      ? rav.remainingCents >= 0 ? "ACHIEVED" : "FAILED"
      : rav.remainingCents < 0 ? "FAILED" : rav.remainingCents < margin ? "AT_RISK" : "ON_TRACK";
    return { month, status, valueCents: rav.remainingCents, limitCents: 0 };
  }

  const cap = goal.capCents ?? 0;
  const spent = rav.fixedChargesCents + rav.oneOffExpensesCents;
  const status: GoalStatus = completed
    ? spent <= cap ? "ACHIEVED" : "FAILED"
    : spent > cap ? "FAILED" : spent * 100 >= cap * CAP_WARNING_PERCENT ? "AT_RISK" : "ON_TRACK";
  return { month, status, valueCents: spent, limitCents: cap };
}

/** Évalue le mois en cours, l'historique depuis la création (12 mois maximum) et la série de mois réussis. */
export function evaluateBehaviorGoal(goal: BehaviorGoalInput, data: Data): GoalEvaluation {
  if (goal.kind === "SPENDING_CAP" && !(Number.isInteger(goal.capCents) && (goal.capCents ?? 0) > 0)) {
    throw new RangeError("Un plafond de dépenses positif est requis");
  }
  const currentMonth = monthOf(data.today);
  const earliest = addMonthsToMonth(currentMonth, -12);
  const start = goal.since > earliest ? goal.since : earliest;
  const history: MonthEvaluation[] = [];
  for (let m = start; m < currentMonth; m = addMonthsToMonth(m, 1)) history.push(evaluateMonth(goal, m, data));
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i]!.status === "ACHIEVED"; i--) streak++;
  return {
    kind: goal.kind,
    capCents: goal.capCents ?? null,
    current: evaluateMonth(goal, currentMonth, data),
    history,
    streak,
  };
}
