import { addMonths } from "./recurrence.js";

export interface Installment {
  /** Rang de l'échéance, à partir de 1. */
  index: number;
  /** Date ISO (YYYY-MM-DD). */
  date: string;
  amountCents: number;
}

/**
 * Paiement en plusieurs fois : `count` échéances mensuelles à partir de `firstDate`, dont la somme vaut exactement `totalCents`.
 * Les centimes qui ne se répartissent pas également vont sur la première échéance (comme les paiements « 4 fois » des commerçants).
 */
export function installmentPlan(totalCents: number, count: number, firstDate: string): Installment[] {
  if (!Number.isInteger(totalCents) || totalCents === 0) throw new RangeError("montant total non nul attendu");
  if (!Number.isInteger(count) || count < 2) throw new RangeError("au moins 2 échéances");
  const sign = Math.sign(totalCents);
  const abs = Math.abs(totalCents);
  const each = Math.floor(abs / count);
  if (each === 0) throw new RangeError("échéance inférieure à un centime");
  const first = new Date(`${firstDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    date: addMonths(first, i).toISOString().slice(0, 10),
    amountCents: sign * (i === 0 ? abs - each * (count - 1) : each),
  }));
}
