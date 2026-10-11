import { describe, expect, it } from "vitest";
import { occurrences, resteAVivre, type RecurringRule } from "./index.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("occurrences", () => {
  it("génère les occurrences hebdomadaires", () => {
    const r: RecurringRule = { id: "a", amountCents: -100, frequency: "WEEKLY", start: "2026-01-05" };
    expect(occurrences(r, "2026-01-01", "2026-01-31").map(iso)).toEqual([
      "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26",
    ]);
  });

  it("ramène le 31 au dernier jour des mois courts", () => {
    const r: RecurringRule = { id: "b", amountCents: -100, frequency: "MONTHLY", start: "2026-01-31" };
    expect(occurrences(r, "2026-01-01", "2026-03-31").map(iso)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31",
    ]);
  });

  it("respecte la fin de règle et la borne basse", () => {
    const r: RecurringRule = { id: "c", amountCents: 1, frequency: "YEARLY", start: "2024-06-01", end: "2026-05-31" };
    expect(occurrences(r, "2025-01-01", "2030-01-01").map(iso)).toEqual(["2025-06-01"]);
  });
});

describe("resteAVivre", () => {
  const rules: RecurringRule[] = [
    { id: "salaire", amountCents: 250_000, frequency: "MONTHLY", start: "2026-01-28" },
    { id: "loyer", amountCents: -80_000, frequency: "MONTHLY", start: "2026-01-05" },
  ];

  it("calcule revenus − charges − ponctuels", () => {
    const res = resteAVivre("2026-02-01", "2026-02-28", rules, [
      { date: "2026-02-10", amountCents: -4_500 },
      { date: "2026-02-12", amountCents: 1_000 },
      { date: "2026-03-01", amountCents: -999_999 },
    ]);
    expect(res).toEqual({
      incomeCents: 251_000,
      fixedChargesCents: 80_000,
      oneOffExpensesCents: 4_500,
      remainingCents: 166_500,
    });
  });

  it("se recalcule à chaque nouvelle sortie", () => {
    const before = resteAVivre("2026-02-01", "2026-02-28", rules, []);
    const after = resteAVivre("2026-02-01", "2026-02-28", rules, [{ date: "2026-02-03", amountCents: -2_000 }]);
    expect(after.remainingCents).toBe(before.remainingCents - 2_000);
  });
});
