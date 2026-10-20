export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function raw(method: string, path: string, body?: unknown) {
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Appel API ; sur 401, une tentative de renouvellement de session puis un seul rejeu. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await raw(method, path, body);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if ((await raw("POST", "/auth/refresh")).ok) res = await raw(method, path, body);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(data.message) ? data.message.join(", ") : (data.message ?? "Erreur");
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Account { id: string; name: string; type: "CHECKING" | "SAVINGS"; balanceCents: number; ibanMasked: string | null }
export interface Tx { id: string; accountId: string; amountCents: number; date: string; label: string }
export interface Rule { id: string; accountId: string; label: string; amountCents: number; frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; start: string; end: string | null }
export interface Summary { from: string; to: string; incomeCents: number; fixedChargesCents: number; oneOffExpensesCents: number; remainingCents: number }

export interface Reminder { enabled: boolean; weekday: number; hour: number; timezone: string; lastDoneAt: string | null; due: boolean; pushConfigured: boolean; subscribed: boolean }
export interface ReviewLine { date: string; label: string; account: string; amountCents: number }
export interface WeeklyReview {
  from: string; to: string; incomeCents: number; expensesCents: number;
  transactions: (ReviewLine & { id: string })[]; recurringInPeriod: ReviewLine[]; upcoming: ReviewLine[];
  month: Summary;
}
