import { describe, expect, it } from "vitest";
import { accountBalanceAt, addDays, dailyBalances, flowsBetween, projectBalance, type ForecastAccount, type ForecastRule } from "./index.js";

const rule = (over: Partial<ForecastRule> & { id: string; amountCents: number; start: string }): ForecastRule => ({
  accountId: "c1", label: over.id, frequency: "MONTHLY", ...over,
});

describe("addDays", () => {
  it("passe les fins de mois et d'année, avant comme après", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("accountBalanceAt", () => {
  const rules = [{ id: "l", amountCents: -100, frequency: "MONTHLY" as const, start: "2026-01-05" }];
  const oneOffs = [{ date: "2026-01-10", amountCents: -200 }, { date: "2026-02-10", amountCents: 50 }];

  it("cumule solde initial, opérations jusqu'à la date et occurrences échues", () => {
    expect(accountBalanceAt("2026-01-31", 1_000, rules, oneOffs)).toBe(700);
    expect(accountBalanceAt("2026-02-05", 1_000, rules, oneOffs)).toBe(600);
    expect(accountBalanceAt("2026-02-10", 1_000, rules, oneOffs)).toBe(650);
  });

  it("ignore une règle qui n'a pas encore commencé", () => {
    expect(accountBalanceAt("2026-01-04", 1_000, rules, [])).toBe(1_000);
  });
});

describe("flowsBetween", () => {
  it("réunit règles et opérations datées dans la période, triées par date", () => {
    const events = flowsBetween("2026-01-10", "2026-02-10", [rule({ id: "loyer", amountCents: -800, start: "2026-01-15" })], [
      { accountId: "c1", date: "2026-01-12", amountCents: -50, label: "Courses" },
      { accountId: "c1", date: "2026-02-20", amountCents: -999, label: "Hors période" },
    ]);
    expect(events.map((e) => [e.date, e.label])).toEqual([["2026-01-12", "Courses"], ["2026-01-15", "loyer"]]);
  });
});

describe("dailyBalances", () => {
  it("applique les flux de chaque jour au solde d'ouverture", () => {
    const days = dailyBalances("2026-01-01", "2026-01-03", { a: 100, b: 0 }, [
      { date: "2026-01-02", accountId: "a", label: "x", amountCents: -30 },
      { date: "2026-01-02", accountId: "b", label: "y", amountCents: 5 },
      { date: "2026-01-03", accountId: "inconnu", label: "z", amountCents: 7 },
    ]);
    expect(days.map((d) => d.byAccount)).toEqual([
      { a: 100, b: 0 },
      { a: 70, b: 5 },
      { a: 70, b: 5, inconnu: 7 },
    ]);
  });
});

describe("projectBalance", () => {
  const accounts: ForecastAccount[] = [
    { id: "c1", type: "CHECKING", balanceCents: 500 },
    { id: "s1", type: "SAVINGS", balanceCents: 2_000 },
  ];
  const rules = [
    rule({ id: "salaire", amountCents: 2_500, start: "2026-01-28" }),
    rule({ id: "loyer", amountCents: -800, start: "2026-01-15" }),
  ];
  const oneOffs = [{ accountId: "c1", date: "2026-02-01", amountCents: -100, label: "Dentiste" }];

  it("projette les soldes jour par jour, le creux et le premier découvert", () => {
    const f = projectBalance({ today: "2026-01-10", days: 30, accounts, rules, oneOffs });
    expect(f.from).toBe("2026-01-10");
    expect(f.to).toBe("2026-02-09");
    expect(f.points).toHaveLength(31);
    expect(f.points[0]).toEqual({ date: "2026-01-10", totalCents: 2_500, checkingCents: 500 });
    expect(f.points.find((p) => p.date === "2026-01-15")).toEqual({ date: "2026-01-15", totalCents: 1_700, checkingCents: -300 });
    expect(f.startCents).toBe(2_500);
    expect(f.endCents).toBe(4_100);
    expect(f.incomeCents).toBe(2_500);
    expect(f.expensesCents).toBe(900);
    expect(f.firstNegativeDate).toBe("2026-01-15");
    expect(f.lowestCheckingCents).toBe(-300);
    expect(f.lowestCheckingDate).toBe("2026-01-15");
    expect(f.accounts).toEqual([
      { id: "c1", endCents: 2_100, minCents: -300, minDate: "2026-01-15", firstNegativeDate: "2026-01-15" },
      { id: "s1", endCents: 2_000, minCents: 2_000, minDate: "2026-01-10", firstNegativeDate: null },
    ]);
    expect(f.events.map((e) => [e.date, e.amountCents])).toEqual([["2026-01-15", -800], ["2026-01-28", 2_500], ["2026-02-01", -100]]);
  });

  it("n'alerte pas sur un compte d'épargne et renvoie un creux nul sans compte courant", () => {
    const f = projectBalance({ today: "2026-01-10", days: 30, accounts: [{ id: "s", type: "SAVINGS", balanceCents: -50 }], rules: [], oneOffs: [] });
    expect(f.firstNegativeDate).toBeNull();
    expect(f.lowestCheckingCents).toBe(0);
    expect(f.lowestCheckingDate).toBeNull();
    expect(f.accounts[0]!.firstNegativeDate).toBe("2026-01-10");
  });

  it("garde le creux le plus bas entre plusieurs comptes courants et le premier découvert le plus proche", () => {
    const f = projectBalance({
      today: "2026-01-10", days: 30,
      accounts: [{ id: "a", type: "CHECKING", balanceCents: 100 }, { id: "b", type: "CHECKING", balanceCents: 100 }],
      rules: [],
      oneOffs: [
        { accountId: "a", date: "2026-01-20", amountCents: -150, label: "A" },
        { accountId: "b", date: "2026-01-12", amountCents: -500, label: "B" },
      ],
    });
    expect(f.firstNegativeDate).toBe("2026-01-12");
    expect(f.lowestCheckingCents).toBe(-400);
    expect(f.lowestCheckingDate).toBe("2026-01-12");
  });

  it("ne rejoue pas ce qui est déjà dans le solde de départ ni les flux d'un compte inconnu", () => {
    const f = projectBalance({
      today: "2026-01-10", days: 7, accounts: [{ id: "c1", type: "CHECKING", balanceCents: 100 }], rules: [],
      oneOffs: [
        { accountId: "c1", date: "2026-01-10", amountCents: -999, label: "Aujourd'hui" },
        { accountId: "autre", date: "2026-01-12", amountCents: -999, label: "Autre foyer" },
      ],
    });
    expect(f.endCents).toBe(100);
    expect(f.events).toEqual([]);
  });

  it("refuse un horizon invalide", () => {
    for (const days of [0, 367, 1.5]) expect(() => projectBalance({ today: "2026-01-10", days, accounts, rules, oneOffs })).toThrow(RangeError);
  });
});
