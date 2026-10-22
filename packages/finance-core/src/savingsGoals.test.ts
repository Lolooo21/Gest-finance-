import { describe, expect, it } from "vitest";
import { advisedMonthly, averageMonthlyExpenses, emergencyFund, evaluateSavingsGoal, monthsUntil, projectSavings, type ForecastOneOff, type ForecastRule, type SavingsGoalInput } from "./index.js";

describe("monthsUntil", () => {
  it("arrondit au mois supérieur, avec au moins 1 mois, et renvoie 0 si la date est passée", () => {
    expect(monthsUntil("2026-01-01", "2026-12-31")).toBe(12);
    expect(monthsUntil("2026-01-01", "2026-01-05")).toBe(1);
    expect(monthsUntil("2026-01-01", "2026-01-01")).toBe(0);
    expect(monthsUntil("2026-02-01", "2026-01-01")).toBe(0);
  });
});

describe("advisedMonthly", () => {
  it("répartit le reste sur les mois, arrondi au centime supérieur", () => {
    expect(advisedMonthly({ savedCents: 0, targetCents: 120_000, months: 12, annualRateBp: 0 })).toBe(10_000);
    expect(advisedMonthly({ savedCents: 10_000, targetCents: 100_000, months: 7, annualRateBp: 0 })).toBe(12_858);
    expect(advisedMonthly({ savedCents: 500_000, targetCents: 100_000, months: 7, annualRateBp: 0 })).toBe(0);
  });

  it("tient compte des intérêts : le versement conseillé est plus bas et atteint la cible (cohérent avec projectSavings)", () => {
    const monthly = advisedMonthly({ savedCents: 100_000, targetCents: 1_000_000, months: 24, annualRateBp: 300 });
    expect(monthly).toBeLessThan(Math.ceil(900_000 / 24));
    const sim = projectSavings({ principalCents: 100_000, monthlyCents: monthly, annualRateBp: 300, years: 2 });
    expect(sim.finalCents + sim.taxCents).toBeGreaterThanOrEqual(1_000_000);
    expect(sim.finalCents).toBeLessThan(1_000_000 + 2 * monthly);
  });

  it("n'a pas besoin de versement quand l'épargne et ses intérêts suffisent, et refuse les paramètres invalides", () => {
    expect(advisedMonthly({ savedCents: 1_000_000, targetCents: 1_000_000, months: 12, annualRateBp: 200 })).toBe(0);
    for (const bad of [{ months: 0 }, { savedCents: -1 }, { targetCents: 1.5 }, { annualRateBp: 2_001 }]) {
      expect(() => advisedMonthly({ savedCents: 0, targetCents: 100, months: 1, annualRateBp: 0, ...bad })).toThrow(RangeError);
    }
  });
});

describe("evaluateSavingsGoal", () => {
  const goal: SavingsGoalInput = { kind: "SHORT_TERM", targetCents: 120_000, targetDate: "2027-01-01", createdOn: "2026-01-01", annualRateBp: 0 };

  it("est en bonne voie au-dessus de la trajectoire linéaire et en retard en dessous", () => {
    const mid = evaluateSavingsGoal(goal, 70_000, "2026-07-02");
    expect(mid).toMatchObject({ savedCents: 70_000, percent: 58, remainingCents: 50_000, monthsLeft: 6, advisedMonthlyCents: 8_334, status: "ON_TRACK" });
    expect(evaluateSavingsGoal(goal, 30_000, "2026-07-02").status).toBe("BEHIND");
  });

  it("est atteint quand la cible est couverte (avancement plafonné à 100 %)", () => {
    const done = evaluateSavingsGoal(goal, 150_000, "2026-07-02");
    expect(done).toMatchObject({ percent: 100, remainingCents: 0, advisedMonthlyCents: 0, status: "ACHIEVED" });
    expect(evaluateSavingsGoal({ ...goal, targetDate: null }, 150_000, "2026-07-02")).toMatchObject({ monthsLeft: null, advisedMonthlyCents: null, status: "ACHIEVED" });
  });

  it("est en retard après l'échéance (tout le reste à verser) et sans échéance n'a pas de trajectoire", () => {
    expect(evaluateSavingsGoal(goal, 90_000, "2027-02-01")).toMatchObject({ monthsLeft: 0, advisedMonthlyCents: 30_000, status: "LATE" });
    expect(evaluateSavingsGoal({ ...goal, kind: "EMERGENCY", targetDate: null }, 10_000, "2026-07-02")).toMatchObject({ monthsLeft: null, advisedMonthlyCents: null, status: "NO_DATE" });
  });

  it("ignore un solde négatif, traite une échéance le jour de création et refuse une cible nulle", () => {
    expect(evaluateSavingsGoal(goal, -50, "2026-02-01").savedCents).toBe(0);
    expect(evaluateSavingsGoal({ ...goal, createdOn: "2026-02-01", targetDate: "2026-02-01" }, 0, "2026-01-15").status).toBe("BEHIND");
    expect(() => evaluateSavingsGoal({ ...goal, targetCents: 0 }, 0, "2026-02-01")).toThrow(RangeError);
  });
});

describe("épargne de secours", () => {
  it("calcule 3 et 6 mois de dépenses et la couverture actuelle", () => {
    expect(emergencyFund(200_000, 300_000)).toEqual({
      averageMonthlyExpensesCents: 200_000, threeMonthsCents: 600_000, sixMonthsCents: 1_200_000, savedCents: 300_000, coverageTenths: 15, belowThreeMonths: true,
    });
    expect(emergencyFund(200_000, 700_000)).toMatchObject({ coverageTenths: 35, belowThreeMonths: false });
    expect(emergencyFund(0, 0)).toMatchObject({ coverageTenths: null, belowThreeMonths: false });
  });
});

describe("averageMonthlyExpenses", () => {
  const rules: ForecastRule[] = [{ id: "loyer", accountId: "c1", label: "Loyer", amountCents: -90_000, frequency: "MONTHLY", start: "2026-01-05" }];
  const out = (date: string, amountCents: number): ForecastOneOff => ({ accountId: "c1", date, amountCents, label: "x" });

  it("moyenne les trois derniers mois terminés (charges fixes + dépenses ponctuelles)", () => {
    const oneOffs = [out("2026-04-10", -30_000), out("2026-05-10", -60_000), out("2026-06-10", -90_000), out("2026-07-10", -999_999)];
    expect(averageMonthlyExpenses("2026-07-15", rules, oneOffs)).toBe(150_000);
  });

  it("ne compte pas les mois d'avant le premier mouvement", () => {
    expect(averageMonthlyExpenses("2026-02-15", rules, [])).toBe(90_000);
  });

  it("se rabat sur le mois en cours sans mois terminé, et vaut 0 sans aucune donnée", () => {
    expect(averageMonthlyExpenses("2026-01-15", rules, [out("2026-01-12", -10_000)])).toBe(100_000);
    expect(averageMonthlyExpenses("2026-01-15", [], [])).toBe(0);
  });
});
