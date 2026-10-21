import { friendlyMessage } from "./errors";

export class ApiError extends Error {
  /** `message` est déjà un texte clair, destiné à l'utilisateur. */
  constructor(readonly status: number, serverMessage?: string) {
    super(friendlyMessage(status, serverMessage));
  }
}

async function raw(method: string, path: string, body?: unknown) {
  try {
    return await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0);
  }
}

/** Lit le message d'erreur d'une réponse ; une réponse qui n'est pas du JSON (page HTML, texte) est ignorée. */
async function errorFrom(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
  return new ApiError(res.status, message);
}

/** Signale au front qu'il faut se reconnecter (le renouvellement de session a échoué). */
const sessionExpired = () => window.dispatchEvent(new Event("session-expired"));

/** Appel API ; sur 401, une tentative de renouvellement de session puis un seul rejeu. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await raw(method, path, body);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if ((await raw("POST", "/auth/refresh")).ok) res = await raw(method, path, body);
    if (res.status === 401) sessionExpired();
  }
  if (!res.ok) throw await errorFrom(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Account { id: string; name: string; type: "CHECKING" | "SAVINGS"; balanceCents: number; ibanMasked: string | null }
export interface Tx { id: string; accountId: string; amountCents: number; date: string; label: string }
export interface Rule { id: string; accountId: string; label: string; amountCents: number; frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; start: string; end: string | null }
export interface Summary { from: string; to: string; incomeCents: number; fixedChargesCents: number; oneOffExpensesCents: number; remainingCents: number }

export interface ForecastAccountView { id: string; name: string; type: "CHECKING" | "SAVINGS"; endCents: number; minCents: number; minDate: string; firstNegativeDate: string | null }
export interface ForecastEventView { date: string; account: string; label: string; amountCents: number }
export interface Forecast {
  from: string; to: string; days: number; startCents: number; endCents: number; incomeCents: number; expensesCents: number;
  points: { date: string; totalCents: number; checkingCents: number }[];
  accounts: ForecastAccountView[]; events: ForecastEventView[];
  firstNegativeDate: string | null; lowestCheckingCents: number; lowestCheckingDate: string | null;
}

export type BehaviorKind = "NO_OVERDRAFT" | "POSITIVE_REMAINING" | "SPENDING_CAP";
export type GoalStatus = "ACHIEVED" | "FAILED" | "ON_TRACK" | "AT_RISK";
export interface MonthEvaluation { month: string; status: GoalStatus; valueCents: number; limitCents: number }
export interface BehaviorGoalView { kind: BehaviorKind; capCents: number | null; current: MonthEvaluation; history: MonthEvaluation[]; streak: number; since: string }

export type SavingsKind = "EMERGENCY" | "SHORT_TERM" | "LONG_TERM";
export type SavingsStatus = "ACHIEVED" | "ON_TRACK" | "BEHIND" | "LATE" | "NO_DATE";
export interface SavingsContributionView { id: string; date: string; amountCents: number; note: string | null }
export interface SavingsGoalView {
  id: string; name: string; kind: SavingsKind; targetCents: number; targetDate: string | null; accountId: string | null; account: string | null; annualRateBp: number;
  savedCents: number; percent: number; remainingCents: number; monthsLeft: number | null; advisedMonthlyCents: number | null; status: SavingsStatus;
  contributions: SavingsContributionView[];
}
export interface SavingsOverview {
  goals: SavingsGoalView[];
  emergency: { averageMonthlyExpensesCents: number; threeMonthsCents: number; sixMonthsCents: number; savedCents: number; coverageTenths: number | null; belowThreeMonths: boolean };
  capacityCents: number; totalAdvisedCents: number;
}

export interface Reminder { enabled: boolean; weekday: number; hour: number; timezone: string; lastDoneAt: string | null; due: boolean; pushConfigured: boolean; subscribed: boolean }
export interface ReviewLine { date: string; label: string; account: string; amountCents: number }
export interface WeeklyReview {
  from: string; to: string; incomeCents: number; expensesCents: number;
  transactions: (ReviewLine & { id: string })[]; recurringInPeriod: ReviewLine[]; upcoming: ReviewLine[];
  month: Summary;
  goals?: {
    behavior: { kind: BehaviorKind; status: GoalStatus; streak: number }[];
    savings: { id: string; name: string; status: SavingsStatus; percent: number; advisedMonthlyCents: number | null }[];
    emergencyBelowThreeMonths: boolean;
  };
}

export interface PayslipExtraction {
  netToPayCents: number | null; grossCents: number | null; periodMonth: string | null; employer: string | null; confidence: number; warnings: string[];
}

/** Envoi d'un fichier (multipart) : le navigateur fixe lui-même le Content-Type et sa frontière. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const send = async () => {
    const form = new FormData();
    form.append("file", file);
    try {
      return await fetch(path, { method: "POST", credentials: "same-origin", body: form });
    } catch {
      throw new ApiError(0);
    }
  };
  let res = await send();
  if (res.status === 401 && (await raw("POST", "/auth/refresh")).ok) res = await send();
  if (res.status === 401) sessionExpired();
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

export interface RegulatedRates { validFrom: string; validTo: string; livretABp: number; lddsBp: number; lepBp: number; sourceUrl: string; note?: string }
export interface IndicatorView {
  key: string; label: string; explanation: string; source: string; sourceUrl: string;
  valueBp: number | null; observedAt: string | null; fetchedAt: string | null; status: "ok" | "stale" | "unavailable";
}
export interface MarketData {
  regulated: { current: RegulatedRates; previous: RegulatedRates | null; stale: boolean; nextRevision: string; pel: { openedIn: number; rateBp: number; sourceUrl: string } | null };
  indicators: IndicatorView[];
  refreshEnabled: boolean;
  disclaimer: string;
}
export interface SavingsProduct {
  id: string; name: string; category: string; risk: 1 | 2 | 3 | 4 | 5; liquidity: string; ceiling: string | null; tax: string;
  horizon: string; summary: string; suitableFor: string; watchOut: string[]; rateRef: "livretA" | "ldds" | "lep" | "pel" | null;
}
