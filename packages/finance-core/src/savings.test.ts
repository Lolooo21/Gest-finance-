import { describe, expect, it } from "vitest";
import { nextRateRevision, projectSavings } from "./index.js";

describe("projectSavings", () => {
  it("sans intérêt : le capital final est la somme des versements", () => {
    const r = projectSavings({ principalCents: 100_000, monthlyCents: 10_000, annualRateBp: 0, years: 2 });
    expect(r).toMatchObject({ finalCents: 340_000, depositedCents: 340_000, grossInterestCents: 0, taxCents: 0, netInterestCents: 0 });
    expect(r.perYear.map((y) => y.balanceCents)).toEqual([220_000, 340_000]);
  });

  it("capitalise mensuellement un capital seul (1 000 € à 12 % pendant 1 an ≈ 1 126,83 €)", () => {
    const r = projectSavings({ principalCents: 100_000, monthlyCents: 0, annualRateBp: 1200, years: 1 });
    expect(r.finalCents).toBe(112_683);
    expect(r.grossInterestCents).toBe(12_683);
  });

  it("calcule les intérêts d'un Livret A à 1,7 % avec versements mensuels", () => {
    const r = projectSavings({ principalCents: 500_000, monthlyCents: 10_000, annualRateBp: 170, years: 5 });
    expect(r.depositedCents).toBe(1_100_000);
    expect(r.grossInterestCents).toBeGreaterThan(65_000);
    expect(r.grossInterestCents).toBeLessThan(75_000);
    expect(r.perYear).toHaveLength(5);
    expect(r.perYear[4]!.balanceCents).toBe(r.finalCents);
  });

  it("applique le prélèvement sur les intérêts à la sortie", () => {
    const r = projectSavings({ principalCents: 100_000, monthlyCents: 0, annualRateBp: 1200, years: 1, taxRateBp: 3000 });
    expect(r.taxCents).toBe(3_805);
    expect(r.netInterestCents).toBe(8_878);
    expect(r.finalCents).toBe(100_000 + 8_878);
  });

  it("gère une durée nulle et des versements seuls", () => {
    expect(projectSavings({ principalCents: 5_000, monthlyCents: 100, annualRateBp: 300, years: 0 })).toMatchObject({ finalCents: 5_000, perYear: [] });
    expect(projectSavings({ principalCents: 0, monthlyCents: 100, annualRateBp: 0, years: 1 }).finalCents).toBe(1_200);
  });

  it("refuse des paramètres hors limites ou non entiers", () => {
    const base = { principalCents: 0, monthlyCents: 0, annualRateBp: 100, years: 1 };
    for (const bad of [{ principalCents: -1 }, { monthlyCents: 1.5 }, { annualRateBp: 2001 }, { annualRateBp: -1 }, { years: 61 }, { years: 1.5 }, { taxRateBp: 10_001 }]) {
      expect(() => projectSavings({ ...base, ...bad })).toThrow(RangeError);
    }
  });
});

describe("nextRateRevision", () => {
  it.each([
    ["2026-10-20T10:00:00Z", "2027-02-01"],
    ["2026-01-15T00:00:00Z", "2026-02-01"],
    ["2026-02-01T00:00:00Z", "2026-08-01"],
    ["2026-07-31T23:59:59Z", "2026-08-01"],
    ["2026-08-01T00:00:00Z", "2027-02-01"],
  ])("à partir du %s → %s", (now, expected) => {
    expect(nextRateRevision(new Date(now))).toBe(expected);
  });
});
