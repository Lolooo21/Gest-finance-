/**
 * Simulation d'épargne et calendrier des taux réglementés. Fonctions pures, montants en centimes entiers,
 * taux en points de base (170 = 1,70 %). Information indicative : jamais un conseil en investissement.
 */
export interface SavingsInput {
  principalCents: number;
  /** Versement en fin de chaque mois. */
  monthlyCents: number;
  /** Taux annuel nominal en points de base (0 à 2000). */
  annualRateBp: number;
  /** Durée en années entières (0 à 60). */
  years: number;
  /** Prélèvement sur les intérêts à la sortie, en points de base (ex. 3000 = 30 %). Livrets réglementés : 0. */
  taxRateBp?: number;
}

export interface SavingsYear {
  year: number;
  /** Solde brut de fin d'année. */
  balanceCents: number;
  depositedCents: number;
  grossInterestCents: number;
}

export interface SavingsResult {
  /** Capital final après prélèvement éventuel. */
  finalCents: number;
  depositedCents: number;
  grossInterestCents: number;
  taxCents: number;
  netInterestCents: number;
  perYear: SavingsYear[];
}

/**
 * Intérêts capitalisés chaque mois au taux annuel / 12 (simplification : les livrets réglementés calculent
 * par quinzaine), sur le solde avant le versement du mois. Le calcul est mené en nombres décimaux et arrondi
 * au centime seulement en sortie, pour ne pas accumuler d'erreurs d'arrondi.
 */
export function projectSavings(input: SavingsInput): SavingsResult {
  const { principalCents, monthlyCents, annualRateBp, years, taxRateBp = 0 } = input;
  const ints = [principalCents, monthlyCents, annualRateBp, years, taxRateBp];
  if (!ints.every(Number.isInteger) || principalCents < 0 || monthlyCents < 0 || annualRateBp < 0 || annualRateBp > 2000 || years < 0 || years > 60 || taxRateBp < 0 || taxRateBp > 10_000) {
    throw new RangeError("Paramètres de simulation invalides");
  }
  const monthlyRate = annualRateBp / 10_000 / 12;
  let exact = principalCents;
  let deposited = principalCents;
  const perYear: SavingsYear[] = [];
  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      exact = exact * (1 + monthlyRate) + monthlyCents;
      deposited += monthlyCents;
    }
    const balanceCents = Math.round(exact);
    perYear.push({ year, balanceCents, depositedCents: deposited, grossInterestCents: balanceCents - deposited });
  }
  const balance = Math.round(exact);
  const grossInterestCents = balance - deposited;
  const taxCents = Math.round((Math.max(0, grossInterestCents) * taxRateBp) / 10_000);
  return {
    finalCents: balance - taxCents,
    depositedCents: deposited,
    grossInterestCents,
    taxCents,
    netInterestCents: grossInterestCents - taxCents,
    perYear,
  };
}

/** Prochaine révision des taux réglementés (Livret A, LDDS, LEP) : le 1er février ou le 1er août suivant `now`. */
export function nextRateRevision(now: Date): string {
  const year = now.getUTCFullYear();
  const candidates = [Date.UTC(year, 1, 1), Date.UTC(year, 7, 1), Date.UTC(year + 1, 1, 1)];
  const next = candidates.find((t) => t > now.getTime())!;
  return new Date(next).toISOString().slice(0, 10);
}
