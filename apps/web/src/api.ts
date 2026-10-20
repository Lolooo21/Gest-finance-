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

export interface Reminder { enabled: boolean; weekday: number; hour: number; timezone: string; lastDoneAt: string | null; due: boolean; pushConfigured: boolean; subscribed: boolean }
export interface ReviewLine { date: string; label: string; account: string; amountCents: number }
export interface WeeklyReview {
  from: string; to: string; incomeCents: number; expensesCents: number;
  transactions: (ReviewLine & { id: string })[]; recurringInPeriod: ReviewLine[]; upcoming: ReviewLine[];
  month: Summary;
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
