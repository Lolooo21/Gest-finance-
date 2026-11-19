import { describe, expect, it } from "vitest";
import { installmentPlan } from "./index.js";

describe("installmentPlan", () => {
  it("répartit le total en échéances mensuelles, reste des centimes sur la première", () => {
    expect(installmentPlan(-10_000, 3, "2026-11-19")).toEqual([
      { index: 1, date: "2026-11-19", amountCents: -3_334 },
      { index: 2, date: "2026-12-19", amountCents: -3_333 },
      { index: 3, date: "2027-01-19", amountCents: -3_333 },
    ]);
  });

  it("garde la somme exacte et le signe, quel que soit le nombre d'échéances", () => {
    for (const count of [2, 4, 10, 12, 48]) {
      const plan = installmentPlan(-123_457, count, "2026-01-01");
      expect(plan).toHaveLength(count);
      expect(plan.reduce((s, p) => s + p.amountCents, 0)).toBe(-123_457);
      expect(plan.every((p) => p.amountCents < 0)).toBe(true);
    }
    expect(installmentPlan(1_000, 4, "2026-01-01").map((p) => p.amountCents)).toEqual([250, 250, 250, 250]);
  });

  it("ramène le 31 au dernier jour des mois plus courts, sans dériver ensuite", () => {
    expect(installmentPlan(-400, 4, "2026-01-31").map((p) => p.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("refuse moins de 2 échéances, un total nul ou des échéances sous le centime", () => {
    expect(() => installmentPlan(-1_000, 1, "2026-01-01")).toThrow(RangeError);
    expect(() => installmentPlan(0, 3, "2026-01-01")).toThrow(RangeError);
    expect(() => installmentPlan(-2, 3, "2026-01-01")).toThrow(RangeError);
  });
});
