/**
 * Rappel hebdomadaire « faire les comptes ».
 * Un « créneau » est le dernier instant (≤ maintenant) où tombent le jour de semaine et l'heure choisis,
 * dans le fuseau horaire de l'utilisateur.
 */
export interface ReminderConfig {
  /** 1 = lundi … 7 = dimanche. */
  weekday: number;
  /** 0–23, heure locale. */
  hour: number;
  /** Fuseau IANA, ex. "Europe/Paris". */
  timezone: string;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")), minute: Number(get("minute")), second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")]!,
  };
}

/** Écart (ms) entre l'heure locale du fuseau et UTC à cet instant. */
function offsetMs(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instant UTC correspondant à une heure murale locale (gère le changement d'heure). */
function zonedToUtc(year: number, month: number, day: number, hour: number, timezone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour);
  let utc = wall - offsetMs(new Date(wall), timezone);
  utc = wall - offsetMs(new Date(utc), timezone);
  return new Date(utc);
}

/** Dernier créneau de rappel ≤ now. */
export function latestSlot(now: Date, cfg: ReminderConfig): Date {
  const local = localParts(now, cfg.timezone);
  let back = (local.weekday - cfg.weekday + 7) % 7;
  if (back === 0 && local.hour < cfg.hour) back = 7;
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day - back));
  return zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), cfg.hour, cfg.timezone);
}

/**
 * Le bilan est « dû » si le dernier créneau est postérieur à l'activation du rappel (`since`)
 * et que le bilan n'a pas été fait depuis ce créneau. Renvoie le créneau ou null.
 */
export function dueSlot(now: Date, cfg: ReminderConfig, since: Date, lastDoneAt: Date | null): Date | null {
  const slot = latestSlot(now, cfg);
  if (slot <= since) return null;
  if (lastDoneAt && lastDoneAt >= slot) return null;
  return slot;
}
