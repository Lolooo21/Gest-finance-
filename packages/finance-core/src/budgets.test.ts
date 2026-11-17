import { describe, expect, it } from "vitest";
import { budgetStatus, categorySpent, evaluateBudget, type CategorizedOneOff, type CategorizedRule } from "./index.js";

const rules: CategorizedRule[] = [
  { id: "netflix", categoryId: "loisirs", amountCents: -1_500, frequency: "MONTHLY", start: "2026-01-10" },
  { id: "salaire", categoryId: null, amountCents: 250_000, frequency: "MONTHLY", start: "2026-01-28" },
  { id: "marche", categoryId: "courses", amountCents: -2_000, frequency: "WEEKLY", start: "2026-03-02" },
];
const tx = (date: string, amountCents: number, categoryId: string | null = "courses"): CategorizedOneOff => ({ date, amountCents, categoryId });

describe("dépenses d'une catégorie", () => {
  it("additionne les sorties ponctuelles et toutes les occurrences récurrentes du mois", () => {
    // 5 lundis en mars 2026 (2, 9, 16, 23, 30) + deux courses dans le mois, une hors du mois.
    const oneOffs = [tx("2026-03-01", -10_000), tx("2026-03-31", -5_000), tx("2026-04-01", -99_999)];
    expect(categorySpent("courses", "2026-03", rules, oneOffs)).toBe(25_000);
    expect(categorySpent("loisirs", "2026-03", rules, oneOffs)).toBe(1_500);
  });

  it("déduit les remboursements sans jamais devenir négatif", () => {
    expect(categorySpent("loisirs", "2026-02", rules, [tx("2026-02-12", 1_000, "loisirs")])).toBe(500);
    expect(categorySpent("loisirs", "2026-02", rules, [tx("2026-02-12", 5_000, "loisirs")])).toBe(0);
  });

  it("mesure aussi les opérations sans catégorie (les revenus ne comptent pas comme des dépenses)", () => {
    expect(categorySpent(null, "2026-02", rules, [tx("2026-02-03", -4_000, null)])).toBe(0);
    expect(categorySpent(null, "2026-02", [], [tx("2026-02-03", -4_000, null), tx("2026-02-04", -1_000, "courses")])).toBe(4_000);
  });
});

describe("statut d'un budget", () => {
  it("alerte à 80 % puis à 100 %", () => {
    expect(budgetStatus(7_999, 10_000)).toBe("OK");
    expect(budgetStatus(8_000, 10_000)).toBe("WARNING");
    expect(budgetStatus(9_999, 10_000)).toBe("WARNING");
    expect(budgetStatus(10_000, 10_000)).toBe("EXCEEDED");
    expect(budgetStatus(12_000, 10_000)).toBe("EXCEEDED");
  });
});

describe("évaluation d'un budget", () => {
  const budget = { limitCents: 40_000, rollover: false, since: "2026-01" };

  it("compare les dépenses du mois au plafond", () => {
    const oneOffs = [tx("2026-03-05", -8_000)];
    expect(evaluateBudget(budget, "courses", "2026-03", rules, oneOffs)).toEqual({
      month: "2026-03", limitCents: 40_000, carryOverCents: 0, availableCents: 40_000,
      spentCents: 18_000, remainingCents: 22_000, percent: 45, status: "OK",
    });
    const over = evaluateBudget(budget, "courses", "2026-03", rules, [tx("2026-03-05", -32_000)]);
    expect(over).toMatchObject({ spentCents: 42_000, remainingCents: -2_000, percent: 105, status: "EXCEEDED" });
  });

  it("reporte le reliquat cumulé depuis le premier mois budgété, jamais un dépassement", () => {
    const withRollover = { ...budget, rollover: true };
    // Janvier : 10 000 dépensés → 30 000 reportés ; février : 70 000 disponibles, 80 000 dépensés → rien à reporter.
    const oneOffs = [tx("2026-01-15", -10_000), tx("2026-02-15", -80_000), tx("2026-03-15", -1_000)];
    expect(evaluateBudget(withRollover, "courses", "2026-02", [], oneOffs)).toMatchObject({ carryOverCents: 30_000, availableCents: 70_000, status: "EXCEEDED" });
    expect(evaluateBudget(withRollover, "courses", "2026-03", [], oneOffs)).toMatchObject({ carryOverCents: 0, availableCents: 40_000, spentCents: 1_000 });
    // Un mois sans dépense reporte tout son plafond.
    expect(evaluateBudget(withRollover, "courses", "2026-05", [], oneOffs)).toMatchObject({ carryOverCents: 79_000, availableCents: 119_000, percent: 0 });
  });

  it("ignore le report avant le premier mois budgété et sans l'option", () => {
    const oneOffs = [tx("2026-01-15", -10_000)];
    expect(evaluateBudget({ ...budget, rollover: true, since: "2026-02" }, "courses", "2026-02", [], oneOffs).carryOverCents).toBe(0);
    expect(evaluateBudget(budget, "courses", "2026-02", [], oneOffs).carryOverCents).toBe(0);
  });

  it("refuse un plafond nul ou négatif", () => {
    expect(() => evaluateBudget({ ...budget, limitCents: 0 }, "courses", "2026-03", [], [])).toThrow(RangeError);
  });
});
