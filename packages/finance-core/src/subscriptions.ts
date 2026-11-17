import { labelPattern, patternMatches } from "./categorize.js";
import { occurrences, type Frequency, type RecurringRule } from "./recurrence.js";

/**
 * Détection des abonnements et récurrences oubliées dans l'historique des opérations, et des hausses de prix.
 * Fonctions pures, montants en centimes signés, dates ISO. Un « marchand » = le mot-clé du libellé (`labelPattern`),
 * par compte et par sens (une entrée et une sortie du même nom ne se mélangent pas).
 */
export interface HistoryTransaction {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  label: string;
  categoryId: string | null;
}

export interface ExistingRule extends RecurringRule {
  accountId: string;
  label: string;
}

/** Une hausse est signalée à partir de 5 % et de 50 centimes. */
export const PRICE_INCREASE_PERCENT = 5;
export const PRICE_INCREASE_MIN_CENTS = 50;

/** Écart d'intervalle accepté autour de la période, et nombre minimal d'occurrences, par fréquence. */
const PERIODS: { frequency: Frequency; days: number; tolerance: number; minCount: number }[] = [
  { frequency: "WEEKLY", days: 7, tolerance: 1, minCount: 4 },
  { frequency: "MONTHLY", days: 30.44, tolerance: 4, minCount: 3 },
  { frequency: "YEARLY", days: 365.25, tolerance: 15, minCount: 2 },
];

const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** Échéance suivant `date` pour cette fréquence (même règle de fin de mois que les récurrences). */
export function nextOccurrence(date: string, frequency: Frequency): string {
  const after = toIso(new Date(toTime(date) + DAY_MS));
  return toIso(occurrences({ id: "next", amountCents: 0, frequency, start: date }, after, toIso(new Date(toTime(date) + 400 * DAY_MS)))[0]!);
}

export interface PriceChange {
  fromCents: number;
  toCents: number;
  /** Hausse en pourcentage, arrondie à l'entier. */
  percent: number;
}

/** Hausse de `to` par rapport à `from` (valeurs absolues), ou null si elle reste sous les seuils. */
export function priceIncrease(fromCents: number, toCents: number): PriceChange | null {
  const before = Math.abs(fromCents);
  const after = Math.abs(toCents);
  if (before === 0 || after - before < PRICE_INCREASE_MIN_CENTS || (after - before) * 100 < before * PRICE_INCREASE_PERCENT) return null;
  return { fromCents, toCents, percent: Math.round(((after - before) * 100) / before) };
}

export interface SubscriptionCandidate {
  /** Identifiant stable du marchand : compte, sens et mot-clé (sert à l'ignorer). */
  key: string;
  accountId: string;
  /** Libellé de la dernière opération. */
  label: string;
  frequency: Frequency;
  /** Montant de la dernière opération. */
  amountCents: number;
  count: number;
  firstDate: string;
  lastDate: string;
  /** Prochaine échéance attendue : une récurrence créée à partir d'elle ne recompte pas le passé. */
  nextDate: string;
  /** Catégorie la plus fréquente de ces opérations. */
  categoryId: string | null;
  /** Hausse de la dernière opération par rapport aux précédentes. */
  increase: PriceChange | null;
}

export const subscriptionKey = (accountId: string, amountCents: number, pattern: string) => `${accountId}|${amountCents < 0 ? "out" : "in"}|${pattern}`;

const sameSign = (a: number, b: number) => (a < 0) === (b < 0);

/** La règle couvre-t-elle déjà ce marchand ? Même compte et même sens, et même mot-clé ou même fréquence à 5 % près du montant. */
function coveredBy(rule: ExistingRule, accountId: string, pattern: string, frequency: Frequency, amountCents: number): boolean {
  if (rule.accountId !== accountId || !sameSign(rule.amountCents, amountCents)) return false;
  if (labelPattern(rule.label) === pattern || patternMatches(pattern, rule.label)) return true;
  return rule.frequency === frequency && Math.abs(Math.abs(rule.amountCents) - Math.abs(amountCents)) * 100 <= Math.abs(amountCents) * 5;
}

/**
 * Opérations qui reviennent à intervalle régulier (hebdomadaire, mensuel, annuel) sans récurrence correspondante.
 * Un marchand est retenu s'il a assez d'occurrences, si au moins la moitié des intervalles sont réguliers (un prélèvement décalé
 * en fausse deux), et s'il est encore
 * actif (dernière opération à moins d'une période et demie de `today`). Les plus chers d'abord.
 */
export function detectSubscriptions(transactions: HistoryTransaction[], rules: ExistingRule[], today: string): SubscriptionCandidate[] {
  const groups = new Map<string, HistoryTransaction[]>();
  for (const t of transactions) {
    const pattern = labelPattern(t.label);
    if (!pattern || t.date > today) continue;
    const key = subscriptionKey(t.accountId, t.amountCents, pattern);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const found: SubscriptionCandidate[] = [];
  for (const [key, list] of groups) {
    const txs = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = txs.slice(1).map((t, i) => (toTime(t.date) - toTime(txs[i]!.date)) / DAY_MS);
    if (gaps.length === 0) continue;
    const typical = median(gaps);
    const period = PERIODS.find((p) => Math.abs(typical - p.days) <= p.tolerance);
    if (!period || txs.length < period.minCount) continue;
    const regular = gaps.filter((g) => Math.abs(g - period.days) <= period.tolerance).length;
    if (regular * 2 < gaps.length) continue;
    const last = txs.at(-1)!;
    if ((toTime(today) - toTime(last.date)) / DAY_MS > period.days * 1.5) continue;
    const pattern = key.split("|")[2]!;
    if (rules.some((r) => coveredBy(r, last.accountId, pattern, period.frequency, last.amountCents))) continue;

    const categories = new Map<string, number>();
    for (const t of txs) if (t.categoryId) categories.set(t.categoryId, (categories.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...categories].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    found.push({
      key,
      accountId: last.accountId,
      label: last.label,
      frequency: period.frequency,
      amountCents: last.amountCents,
      count: txs.length,
      firstDate: txs[0]!.date,
      lastDate: last.date,
      nextDate: nextOccurrence(last.date, period.frequency),
      categoryId,
      increase: priceIncrease(median(txs.slice(0, -1).map((t) => t.amountCents)), last.amountCents),
    });
  }
  return found.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
}

export interface RuleDrift {
  ruleId: string;
  ruleLabel: string;
  ruleAmountCents: number;
  /** Opération récente du même marchand dont le montant diffère de la récurrence. */
  transactionId: string;
  date: string;
  observedAmountCents: number;
  increase: PriceChange | null;
  /** Échéance de la règle que cette opération remplace (la plus proche). */
  occurrence: string;
}

/** Fenêtre de recherche des écarts : les 45 derniers jours. */
export const DRIFT_WINDOW_DAYS = 45;

/**
 * Récurrences dont le prélèvement réel récent n'a plus le même montant (hausse ou baisse) : le plus souvent un abonnement
 * qui a augmenté. Une opération correspond à la règle si même compte, même sens, même mot-clé, et à 7 jours au plus d'une
 * échéance. Seule la plus récente compte par règle.
 */
export function detectRuleDrifts(transactions: HistoryTransaction[], rules: ExistingRule[], today: string): RuleDrift[] {
  const since = toIso(new Date(toTime(today) - DRIFT_WINDOW_DAYS * DAY_MS));
  const drifts: RuleDrift[] = [];
  for (const rule of rules) {
    const pattern = labelPattern(rule.label);
    if (!pattern) continue;
    const recent = transactions
      .filter((t) => t.accountId === rule.accountId && sameSign(t.amountCents, rule.amountCents) && t.date >= since && t.date <= today)
      .filter((t) => labelPattern(t.label) === pattern || patternMatches(pattern, t.label))
      .sort((a, b) => b.date.localeCompare(a.date));
    for (const t of recent) {
      const near = occurrences(rule, toIso(new Date(toTime(t.date) - 7 * DAY_MS)), toIso(new Date(toTime(t.date) + 7 * DAY_MS)))
        .map(toIso)
        .sort((a, b) => Math.abs(toTime(a) - toTime(t.date)) - Math.abs(toTime(b) - toTime(t.date)))[0];
      if (!near) continue;
      if (t.amountCents !== rule.amountCents) {
        drifts.push({
          ruleId: rule.id, ruleLabel: rule.label, ruleAmountCents: rule.amountCents, transactionId: t.id, date: t.date,
          observedAmountCents: t.amountCents, increase: priceIncrease(rule.amountCents, t.amountCents), occurrence: near,
        });
      }
      break;
    }
  }
  return drifts;
}
