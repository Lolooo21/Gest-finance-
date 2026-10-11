/** Montants en centimes (entiers) ; positifs = revenu, négatifs = dépense. */
export type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurringRule {
  id: string;
  amountCents: number;
  frequency: Frequency;
  /** Date de début (UTC, YYYY-MM-DD). */
  start: string;
  /** Date de fin incluse (optionnelle). */
  end?: string;
}

const DAY_MS = 86_400_000;

const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

function addMonths(base: Date, months: number): Date {
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/**
 * Occurrences d'une règle dans [from, to] (bornes incluses, dates ISO).
 * Pour MONTHLY/YEARLY, le jour est ramené au dernier jour du mois si besoin (31 → 30/28).
 */
export function occurrences(rule: RecurringRule, from: string, to: string): Date[] {
  const start = toDate(rule.start);
  const lo = toDate(from);
  const hi = toDate(rule.end && rule.end < to ? rule.end : to);
  const result: Date[] = [];
  for (let i = 0; ; i++) {
    const d =
      rule.frequency === "WEEKLY"
        ? new Date(start.getTime() + i * 7 * DAY_MS)
        : addMonths(start, i * (rule.frequency === "MONTHLY" ? 1 : 12));
    if (d > hi) break;
    if (d >= lo) result.push(d);
  }
  return result;
}
