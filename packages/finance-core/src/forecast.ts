import { occurrences, type RecurringRule } from "./recurrence.js";

/**
 * Prévisionnel de trésorerie. Fonctions pures, montants en centimes entiers, dates ISO (YYYY-MM-DD, UTC).
 * Le solde de départ est celui de la fin du jour `today` : le prévisionnel ne rejoue que ce qui est PLUS TARD (règles récurrentes
 * à venir, opérations déjà saisies avec une date future).
 */
export type AccountKind = "CHECKING" | "SAVINGS";

export interface ForecastAccount {
  id: string;
  type: AccountKind;
  /** Solde à la fin de `today`. */
  balanceCents: number;
}

export interface ForecastRule extends RecurringRule {
  accountId: string;
  label: string;
}

export interface ForecastOneOff {
  accountId: string;
  /** Date ISO. */
  date: string;
  amountCents: number;
  label: string;
}

export interface ForecastEvent {
  date: string;
  accountId: string;
  label: string;
  amountCents: number;
}

export interface ForecastPoint {
  date: string;
  /** Solde de tous les comptes. */
  totalCents: number;
  /** Solde des comptes courants seulement (c'est lui qui peut passer sous zéro). */
  checkingCents: number;
}

export interface AccountForecast {
  id: string;
  endCents: number;
  minCents: number;
  minDate: string;
  /** Premier jour où le solde est négatif, ou null. */
  firstNegativeDate: string | null;
}

export interface Forecast {
  from: string;
  to: string;
  startCents: number;
  endCents: number;
  /** Revenus et dépenses attendus sur la période (hors solde de départ). */
  incomeCents: number;
  expensesCents: number;
  points: ForecastPoint[];
  accounts: AccountForecast[];
  events: ForecastEvent[];
  /** Premier jour où un compte courant passe sous zéro, ou null. */
  firstNegativeDate: string | null;
  /** Solde le plus bas d'un compte courant sur la période (0 s'il n'y en a pas) et sa date. */
  lowestCheckingCents: number;
  lowestCheckingDate: string | null;
}

const DAY_MS = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => toIso(new Date(toDate(iso).getTime() + days * DAY_MS));

/** Solde d'un compte à la fin du jour `date` : solde initial + opérations jusqu'à cette date + occurrences échues des règles. */
export function accountBalanceAt(date: string, initialCents: number, rules: RecurringRule[], oneOffs: { date: string; amountCents: number }[]): number {
  let balance = initialCents;
  for (const t of oneOffs) if (t.date <= date) balance += t.amountCents;
  for (const r of rules) if (r.start <= date) balance += occurrences(r, r.start, date).length * r.amountCents;
  return balance;
}

/** Tous les flux (règles + opérations datées) dans [from, to], triés par date. */
export function flowsBetween(from: string, to: string, rules: ForecastRule[], oneOffs: ForecastOneOff[]): ForecastEvent[] {
  const events: ForecastEvent[] = [];
  for (const r of rules) {
    for (const d of occurrences(r, from, to)) events.push({ date: toIso(d), accountId: r.accountId, label: r.label, amountCents: r.amountCents });
  }
  for (const t of oneOffs) {
    if (t.date >= from && t.date <= to) events.push({ date: t.date, accountId: t.accountId, label: t.label, amountCents: t.amountCents });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export interface DailyBalance {
  date: string;
  byAccount: Record<string, number>;
}

/** Soldes jour par jour de `from` à `to` (inclus) : ouverture (fin de la veille de `from`) puis application des flux de chaque jour. */
export function dailyBalances(from: string, to: string, opening: Record<string, number>, events: ForecastEvent[]): DailyBalance[] {
  const byDate = new Map<string, ForecastEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const current = { ...opening };
  const days: DailyBalance[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const e of byDate.get(date) ?? []) current[e.accountId] = (current[e.accountId] ?? 0) + e.amountCents;
    days.push({ date, byAccount: { ...current } });
  }
  return days;
}

/**
 * Solde projeté de `today` à `today + days` : points quotidiens, creux, premier jour de découvert et événements à venir.
 * `days` est borné à [1, 366].
 */
export function projectBalance(input: { today: string; days: number; accounts: ForecastAccount[]; rules: ForecastRule[]; oneOffs: ForecastOneOff[] }): Forecast {
  const { today, days, accounts, rules, oneOffs } = input;
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new RangeError("Horizon invalide (1 à 366 jours)");
  const to = addDays(today, days);
  const events = flowsBetween(addDays(today, 1), to, rules, oneOffs).filter((e) => accounts.some((a) => a.id === e.accountId));
  const opening = Object.fromEntries(accounts.map((a) => [a.id, a.balanceCents]));
  const series = dailyBalances(today, to, opening, events);
  const checking = accounts.filter((a) => a.type === "CHECKING");
  const sum = (day: DailyBalance, list: ForecastAccount[]) => list.reduce((acc, a) => acc + (day.byAccount[a.id] ?? 0), 0);

  const points = series.map((d) => ({ date: d.date, totalCents: sum(d, accounts), checkingCents: sum(d, checking) }));
  const accountForecasts: AccountForecast[] = accounts.map((a) => {
    let min = series[0]!.byAccount[a.id] ?? 0;
    let minDate = series[0]!.date;
    let firstNegative: string | null = null;
    for (const d of series) {
      const v = d.byAccount[a.id] ?? 0;
      if (v < min) {
        min = v;
        minDate = d.date;
      }
      if (v < 0 && firstNegative === null) firstNegative = d.date;
    }
    return { id: a.id, endCents: series[series.length - 1]!.byAccount[a.id] ?? 0, minCents: min, minDate, firstNegativeDate: firstNegative };
  });

  const checkingForecasts = accountForecasts.filter((f) => checking.some((a) => a.id === f.id));
  const negatives = checkingForecasts.flatMap((f) => (f.firstNegativeDate ? [f.firstNegativeDate] : [])).sort();
  const lowest = checkingForecasts.reduce<AccountForecast | null>((acc, f) => (acc === null || f.minCents < acc.minCents ? f : acc), null);

  return {
    from: today,
    to,
    startCents: points[0]!.totalCents,
    endCents: points[points.length - 1]!.totalCents,
    incomeCents: events.reduce((acc, e) => acc + Math.max(0, e.amountCents), 0),
    expensesCents: events.reduce((acc, e) => acc + Math.max(0, -e.amountCents), 0),
    points,
    accounts: accountForecasts,
    events,
    firstNegativeDate: negatives[0] ?? null,
    lowestCheckingCents: lowest?.minCents ?? 0,
    lowestCheckingDate: lowest?.minDate ?? null,
  };
}
