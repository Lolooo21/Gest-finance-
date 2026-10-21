import { describe, expect, it } from "vitest";
import { addMonthsToMonth, evaluateBehaviorGoal, evaluateMonth, lastDay, type ForecastOneOff, type ForecastRule, type GoalAccount } from "./index.js";

const accounts: GoalAccount[] = [{ id: "c1", type: "CHECKING", initialCents: 1_000 }];
const rules: ForecastRule[] = [
  { id: "salaire", accountId: "c1", label: "Salaire", amountCents: 2_000, frequency: "MONTHLY", start: "2026-01-28" },
  { id: "loyer", accountId: "c1", label: "Loyer", amountCents: -900, frequency: "MONTHLY", start: "2026-01-05" },
];
const out = (date: string, amountCents: number): ForecastOneOff => ({ accountId: "c1", date, amountCents, label: "Dépense" });
const data = (oneOffs: ForecastOneOff[] = [], over: Partial<{ accounts: GoalAccount[]; today: string }> = {}) => ({
  today: "2026-03-15", accounts, rules, oneOffs, ...over,
});

describe("calendrier", () => {
  it("donne le dernier jour d'un mois et décale les mois", () => {
    expect(lastDay("2026-02")).toBe("2026-02-28");
    expect(lastDay("2024-02")).toBe("2024-02-29");
    expect(lastDay("2026-12")).toBe("2026-12-31");
    expect(addMonthsToMonth("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToMonth("2026-11", 3)).toBe("2027-02");
  });
});

describe("objectif « pas de découvert »", () => {
  const goal = { kind: "NO_OVERDRAFT" as const };

  it("réussit un mois terminé sans découvert et mesure le solde le plus bas", () => {
    expect(evaluateMonth(goal, "2026-01", data())).toEqual({ month: "2026-01", status: "ACHIEVED", valueCents: 100, limitCents: 0 });
    expect(evaluateMonth(goal, "2026-02", data()).valueCents).toBe(1_200);
  });

  it("rate un mois terminé avec un découvert", () => {
    const feb = evaluateMonth(goal, "2026-02", data([out("2026-02-10", -1_500)]));
    expect(feb).toEqual({ month: "2026-02", status: "FAILED", valueCents: -300, limitCents: 0 });
  });

  it("mois en cours : en bonne voie, à risque (découvert prévu) ou déjà raté", () => {
    expect(evaluateMonth(goal, "2026-03", data()).status).toBe("ON_TRACK");
    expect(evaluateMonth(goal, "2026-03", data([out("2026-03-20", -2_400)])).status).toBe("AT_RISK");
    expect(evaluateMonth(goal, "2026-03", data([out("2026-03-10", -2_400)])).status).toBe("FAILED");
  });

  it("ne regarde que les comptes courants", () => {
    const savingsOnly: GoalAccount[] = [{ id: "s1", type: "SAVINGS", initialCents: -500 }];
    expect(evaluateMonth(goal, "2026-02", data([], { accounts: savingsOnly }))).toMatchObject({ status: "ACHIEVED", valueCents: 0 });
  });
});

describe("objectif « reste à vivre positif »", () => {
  const goal = { kind: "POSITIVE_REMAINING" as const };

  it("mois terminé : réussi si le reste à vivre est positif, raté sinon", () => {
    expect(evaluateMonth(goal, "2026-01", data())).toEqual({ month: "2026-01", status: "ACHIEVED", valueCents: 1_100, limitCents: 0 });
    expect(evaluateMonth(goal, "2026-02", data([out("2026-02-10", -1_200)]))).toMatchObject({ status: "FAILED", valueCents: -100 });
  });

  it("mois en cours : en bonne voie, à risque sous 10 % des revenus, raté si négatif", () => {
    expect(evaluateMonth(goal, "2026-03", data()).status).toBe("ON_TRACK");
    expect(evaluateMonth(goal, "2026-03", data([out("2026-03-10", -950)])).status).toBe("AT_RISK");
    expect(evaluateMonth(goal, "2026-03", data([out("2026-03-10", -1_200)])).status).toBe("FAILED");
  });
});

describe("objectif « dépenses sous X € »", () => {
  it("mois terminé : réussi jusqu'au plafond inclus, raté au-delà", () => {
    expect(evaluateMonth({ kind: "SPENDING_CAP", capCents: 900 }, "2026-01", data())).toEqual({ month: "2026-01", status: "ACHIEVED", valueCents: 900, limitCents: 900 });
    expect(evaluateMonth({ kind: "SPENDING_CAP", capCents: 899 }, "2026-01", data()).status).toBe("FAILED");
  });

  it("mois en cours : alerte à 80 % du plafond, raté au-delà", () => {
    expect(evaluateMonth({ kind: "SPENDING_CAP", capCents: 2_000 }, "2026-03", data()).status).toBe("ON_TRACK");
    expect(evaluateMonth({ kind: "SPENDING_CAP", capCents: 1_000 }, "2026-03", data()).status).toBe("AT_RISK");
    expect(evaluateMonth({ kind: "SPENDING_CAP", capCents: 800 }, "2026-03", data()).status).toBe("FAILED");
  });
});

describe("evaluateBehaviorGoal", () => {
  it("évalue le mois en cours, l'historique depuis la création et la série de mois réussis", () => {
    const e = evaluateBehaviorGoal({ kind: "NO_OVERDRAFT", since: "2026-01" }, data());
    expect(e.kind).toBe("NO_OVERDRAFT");
    expect(e.capCents).toBeNull();
    expect(e.history.map((m) => [m.month, m.status])).toEqual([["2026-01", "ACHIEVED"], ["2026-02", "ACHIEVED"]]);
    expect(e.streak).toBe(2);
    expect(e.current.month).toBe("2026-03");
  });

  it("remet la série à zéro après un mois raté", () => {
    const e = evaluateBehaviorGoal({ kind: "NO_OVERDRAFT", since: "2026-01" }, data([out("2026-02-10", -1_500)]));
    expect(e.history.map((m) => m.status)).toEqual(["ACHIEVED", "FAILED"]);
    expect(e.streak).toBe(0);
    const rebound = evaluateBehaviorGoal({ kind: "NO_OVERDRAFT", since: "2026-01" }, data([out("2026-01-10", -1_100)]));
    expect(rebound.history.map((m) => m.status)).toEqual(["FAILED", "ACHIEVED"]);
    expect(rebound.streak).toBe(1);
  });

  it("n'a pas d'historique pour un objectif créé ce mois-ci et le borne à 12 mois", () => {
    expect(evaluateBehaviorGoal({ kind: "POSITIVE_REMAINING", since: "2026-03" }, data())).toMatchObject({ history: [], streak: 0 });
    const old = evaluateBehaviorGoal({ kind: "NO_OVERDRAFT", since: "2020-01" }, data());
    expect(old.history).toHaveLength(12);
    expect(old.history[0]!.month).toBe("2025-03");
  });

  it("renvoie le plafond configuré et exige un plafond positif", () => {
    expect(evaluateBehaviorGoal({ kind: "SPENDING_CAP", capCents: 1_500, since: "2026-03" }, data()).capCents).toBe(1_500);
    for (const capCents of [undefined, 0, -5, 10.5]) {
      expect(() => evaluateBehaviorGoal({ kind: "SPENDING_CAP", ...(capCents === undefined ? {} : { capCents }), since: "2026-03" }, data())).toThrow(RangeError);
    }
  });
});
