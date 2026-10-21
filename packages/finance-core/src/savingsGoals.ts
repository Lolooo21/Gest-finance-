import { resteAVivre } from "./resteAVivre.js";
import { addMonthsToMonth, lastDay } from "./goals.js";
import type { ForecastOneOff, ForecastRule } from "./forecast.js";

/**
 * Objectifs d'épargne : progression, versement mensuel conseillé et épargne de secours.
 * Fonctions pures, montants en centimes entiers, dates ISO. Information indicative, jamais un conseil en investissement.
 */
export type SavingsKind = "EMERGENCY" | "SHORT_TERM" | "LONG_TERM";

/** ACHIEVED : cible atteinte · ON_TRACK : en avance ou à l'heure · BEHIND : en retard sur la trajectoire · LATE : date dépassée, cible non atteinte · NO_DATE : sans échéance. */
export type SavingsStatus = "ACHIEVED" | "ON_TRACK" | "BEHIND" | "LATE" | "NO_DATE";

export interface SavingsGoalInput {
  kind: SavingsKind;
  targetCents: number;
  /** Échéance ISO, ou null (épargne de secours : pas d'échéance obligatoire). */
  targetDate: string | null;
  /** Date de création ISO : début de la trajectoire. */
  createdOn: string;
  /** Taux annuel espéré en points de base (0 = sans intérêts). */
  annualRateBp: number;
}

export interface SavingsGoalEvaluation {
  savedCents: number;
  targetCents: number;
  /** Avancement entier de 0 à 100. */
  percent: number;
  remainingCents: number;
  /** Mois restants jusqu'à l'échéance (au moins 1), ou null sans échéance. */
  monthsLeft: number | null;
  /** Versement mensuel conseillé pour atteindre la cible à l'échéance (0 si atteinte), ou null sans échéance. */
  advisedMonthlyCents: number | null;
  status: SavingsStatus;
}

const toTime = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

/** Mois restants de `today` à `target`, en mois civils (un mois entamé compte pour un mois, minimum 1) ; 0 si l'échéance est aujourd'hui ou passée. */
export function monthsUntil(today: string, target: string): number {
  if (target <= today) return 0;
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const [gy, gm, gd] = target.split("-").map(Number) as [number, number, number];
  const diff = (gy - ty) * 12 + (gm - tm);
  const full = gd < td ? diff - 1 : diff;
  return Math.max(1, gd === td ? full : full + 1);
}

/**
 * Versement mensuel (fin de mois) qui amène `savedCents` à `targetCents` en `months` mois, avec intérêts capitalisés chaque mois
 * (même convention que `projectSavings`). Arrondi au centime supérieur ; 0 si la cible est déjà atteinte.
 */
export function advisedMonthly(input: { savedCents: number; targetCents: number; months: number; annualRateBp: number }): number {
  const { savedCents, targetCents, months, annualRateBp } = input;
  if (![savedCents, targetCents, months, annualRateBp].every(Number.isInteger) || savedCents < 0 || targetCents < 0 || months < 1 || annualRateBp < 0 || annualRateBp > 2000) {
    throw new RangeError("Paramètres d'objectif invalides");
  }
  const monthlyRate = annualRateBp / 10_000 / 12;
  if (monthlyRate === 0) return Math.max(0, Math.ceil((targetCents - savedCents) / months));
  const growth = (1 + monthlyRate) ** months;
  const stillNeeded = targetCents - savedCents * growth;
  return stillNeeded <= 0 ? 0 : Math.ceil((stillNeeded * monthlyRate) / (growth - 1));
}

/** Avancement d'un objectif d'épargne à la date `today`, d'après les versements déjà enregistrés. */
export function evaluateSavingsGoal(goal: SavingsGoalInput, savedCents: number, today: string): SavingsGoalEvaluation {
  if (!Number.isInteger(goal.targetCents) || goal.targetCents <= 0) throw new RangeError("La cible doit être positive");
  const saved = Math.max(0, savedCents);
  const remaining = Math.max(0, goal.targetCents - saved);
  const percent = Math.min(100, Math.floor((saved * 100) / goal.targetCents));
  const base = { savedCents: saved, targetCents: goal.targetCents, percent, remainingCents: remaining };
  if (remaining === 0) return { ...base, monthsLeft: goal.targetDate ? monthsUntil(today, goal.targetDate) : null, advisedMonthlyCents: goal.targetDate ? 0 : null, status: "ACHIEVED" };
  if (!goal.targetDate) return { ...base, monthsLeft: null, advisedMonthlyCents: null, status: "NO_DATE" };

  const monthsLeft = monthsUntil(today, goal.targetDate);
  if (monthsLeft === 0) return { ...base, monthsLeft: 0, advisedMonthlyCents: remaining, status: "LATE" };
  const advisedMonthlyCents = advisedMonthly({ savedCents: saved, targetCents: goal.targetCents, months: monthsLeft, annualRateBp: goal.annualRateBp });
  // Trajectoire linéaire de la création à l'échéance : l'objectif est « en retard » s'il est sous la cible attendue aujourd'hui.
  const span = toTime(goal.targetDate) - toTime(goal.createdOn);
  const elapsed = Math.min(Math.max(toTime(today) - toTime(goal.createdOn), 0), span);
  const expected = span > 0 ? (goal.targetCents * elapsed) / span : goal.targetCents;
  return { ...base, monthsLeft, advisedMonthlyCents, status: saved >= expected ? "ON_TRACK" : "BEHIND" };
}

export interface EmergencyFund {
  averageMonthlyExpensesCents: number;
  /** Cible minimale (3 mois de dépenses) et confortable (6 mois). */
  threeMonthsCents: number;
  sixMonthsCents: number;
  savedCents: number;
  /** Mois de dépenses couverts, en dixièmes de mois (18 = 1,8 mois), ou null si les dépenses moyennes sont nulles. */
  coverageTenths: number | null;
  /** Vrai si le fonds ne couvre pas 3 mois de dépenses. */
  belowThreeMonths: boolean;
}

/** Épargne de secours : cibles de 3 à 6 mois de dépenses moyennes et couverture actuelle. */
export function emergencyFund(averageMonthlyExpensesCents: number, savedCents: number): EmergencyFund {
  const threeMonthsCents = averageMonthlyExpensesCents * 3;
  return {
    averageMonthlyExpensesCents,
    threeMonthsCents,
    sixMonthsCents: averageMonthlyExpensesCents * 6,
    savedCents,
    coverageTenths: averageMonthlyExpensesCents > 0 ? Math.floor((savedCents * 10) / averageMonthlyExpensesCents) : null,
    belowThreeMonths: savedCents < threeMonthsCents,
  };
}

/**
 * Dépenses mensuelles moyennes (charges fixes + dépenses ponctuelles) sur les `months` derniers mois TERMINÉS qui ont de l'activité
 * (règle commencée ou opération saisie). Sans mois terminé exploitable, on retient le mois en cours.
 */
export function averageMonthlyExpenses(today: string, rules: ForecastRule[], oneOffs: ForecastOneOff[], months = 3): number {
  const current = today.slice(0, 7);
  const firstActivity = [...rules.map((r) => r.start), ...oneOffs.map((t) => t.date)].sort()[0]?.slice(0, 7);
  const spent = (month: string) => {
    const r = resteAVivre(`${month}-01`, lastDay(month), rules, oneOffs.map((t) => ({ date: t.date, amountCents: t.amountCents })));
    return r.fixedChargesCents + r.oneOffExpensesCents;
  };
  const totals: number[] = [];
  for (let i = 1; i <= months; i++) {
    const month = addMonthsToMonth(current, -i);
    if (firstActivity && month >= firstActivity) totals.push(spent(month));
  }
  if (totals.length === 0) return spent(current);
  return Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
}
