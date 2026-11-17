import { describe, expect, it } from "vitest";
import {
  detectRuleDrifts, detectSubscriptions, nextOccurrence, priceIncrease, subscriptionKey, type ExistingRule, type HistoryTransaction,
} from "./index.js";

const TODAY = "2026-11-10";
let n = 0;
const tx = (date: string, amountCents: number, label: string, extra: Partial<HistoryTransaction> = {}): HistoryTransaction =>
  ({ id: `t${++n}`, accountId: "a1", date, amountCents, label, categoryId: null, ...extra });
const monthly = (label: string, amountCents: number, dates: string[], extra: Partial<HistoryTransaction> = {}) => dates.map((d) => tx(d, amountCents, label, extra));

describe("échéances et hausses", () => {
  it("calcule l'échéance suivante, fin de mois comprise", () => {
    expect(nextOccurrence("2026-10-05", "MONTHLY")).toBe("2026-11-05");
    expect(nextOccurrence("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(nextOccurrence("2026-11-02", "WEEKLY")).toBe("2026-11-09");
    expect(nextOccurrence("2025-12-15", "YEARLY")).toBe("2026-12-15");
  });

  it("signale une hausse à partir de 5 % et de 50 centimes", () => {
    expect(priceIncrease(-1599, -1799)).toEqual({ fromCents: -1599, toCents: -1799, percent: 13 });
    expect(priceIncrease(-1000, -1040)).toBeNull(); // 4 %
    expect(priceIncrease(-500, -540)).toBeNull(); // 8 % mais 40 centimes
    expect(priceIncrease(-1799, -1599)).toBeNull(); // baisse
    expect(priceIncrease(0, -100)).toBeNull();
  });
});

describe("détection des abonnements", () => {
  it("trouve un abonnement mensuel, sa prochaine échéance, sa catégorie et une hausse de prix", () => {
    const history = [
      ...monthly("PRLV SEPA NETFLIX.COM", -1599, ["2026-07-05", "2026-08-05", "2026-09-04"], { categoryId: "loisirs" }),
      tx("2026-10-06", -1799, "PRLV SEPA NETFLIX.COM 0610"),
    ];
    expect(detectSubscriptions(history, [], TODAY)).toEqual([{
      key: subscriptionKey("a1", -1799, "netflix"), accountId: "a1", label: "PRLV SEPA NETFLIX.COM 0610", frequency: "MONTHLY",
      amountCents: -1799, count: 4, firstDate: "2026-07-05", lastDate: "2026-10-06", nextDate: "2026-11-06", categoryId: "loisirs",
      increase: { fromCents: -1599, toCents: -1799, percent: 13 },
    }]);
  });

  it("reconnaît les rythmes hebdomadaire et annuel, et trie du plus cher au moins cher", () => {
    const history = [
      ...monthly("CB MARCHE BIO", -2000, ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]),
      tx("2025-11-15", -42000, "PRLV ASSURANCE HABITATION"), tx("2026-11-14", -42000, "PRLV ASSURANCE HABITATION"),
      tx("2025-11-03", -45000, "PRLV MUTUELLE SANTE"), tx("2026-11-02", -45000, "PRLV MUTUELLE SANTE"),
    ];
    // Une opération datée après aujourd'hui n'est pas prise en compte : une seule assurance passée, pas de rythme.
    const found = detectSubscriptions(history, [], TODAY);
    expect(found.map((s) => [s.label, s.frequency, s.nextDate])).toEqual([
      ["PRLV MUTUELLE SANTE", "YEARLY", "2027-11-02"],
      ["CB MARCHE BIO", "WEEKLY", "2026-11-16"],
    ]);
  });

  it("ignore l'irrégulier, l'arrêté, le trop rare, les libellés sans mot-clé, et sépare entrées et sorties", () => {
    const history = [
      ...monthly("CB RESTAURANT", -3000, ["2026-08-02", "2026-08-09", "2026-09-28", "2026-10-30", "2026-11-01"]),
      ...monthly("PRLV SALLE SPORT", -2990, ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"]),
      ...monthly("PRLV CANAL", -2499, ["2026-09-08", "2026-10-08"]),
      ...monthly("CB 1234", -999, ["2026-08-10", "2026-09-10", "2026-10-10"]),
      ...monthly("VIR CAF", 30000, ["2026-08-05", "2026-09-05", "2026-10-05"]),
      ...monthly("PRLV CAF", -1000, ["2026-09-20", "2026-10-20"]),
    ];
    const found = detectSubscriptions(history, [], TODAY);
    expect(found.map((s) => [s.label, s.amountCents, s.increase])).toEqual([["VIR CAF", 30000, null]]);
    expect(found[0]!.key).toBe("a1|in|caf");
  });

  it("tolère un prélèvement décalé, pas un rythme irrégulier", () => {
    const ok = monthly("PRLV EDF", -8000, ["2026-06-10", "2026-07-10", "2026-08-25", "2026-09-10", "2026-10-10"]);
    expect(detectSubscriptions(ok, [], TODAY)).toHaveLength(1);
    const ko = monthly("PRLV EDF", -8000, ["2026-06-10", "2026-07-25", "2026-08-10", "2026-09-25", "2026-10-10"]);
    expect(detectSubscriptions(ko, [], TODAY)).toHaveLength(0);
  });

  it("n'affiche pas ce qu'une récurrence couvre déjà : même mot-clé, ou même fréquence et montant proche", () => {
    const history = [
      ...monthly("PRLV SEPA NETFLIX.COM", -1599, ["2026-08-05", "2026-09-05", "2026-10-05"]),
      ...monthly("PRLV FREE MOBILE", -1999, ["2026-08-12", "2026-09-12", "2026-10-12"]),
      ...monthly("PRLV DEEZER", -1099, ["2026-08-20", "2026-09-20", "2026-10-20"]),
    ];
    const rules: ExistingRule[] = [
      { id: "r1", accountId: "a1", label: "Netflix", amountCents: -1500, frequency: "MONTHLY", start: "2026-01-05" },
      { id: "r2", accountId: "a1", label: "Forfait téléphone", amountCents: -2000, frequency: "MONTHLY", start: "2026-01-12" },
      { id: "r3", accountId: "a2", label: "Deezer", amountCents: -1099, frequency: "MONTHLY", start: "2026-01-20" },
      { id: "r4", accountId: "a1", label: "Musique", amountCents: 1099, frequency: "MONTHLY", start: "2026-01-20" },
    ];
    // Deezer reste : la règle « Deezer » est sur un autre compte, et « Musique » est une entrée.
    expect(detectSubscriptions(history, rules, TODAY).map((s) => s.label)).toEqual(["PRLV DEEZER"]);
  });
});

describe("écarts avec les récurrences", () => {
  const rule: ExistingRule = { id: "r1", accountId: "a1", label: "Netflix", amountCents: -1599, frequency: "MONTHLY", start: "2026-01-05" };

  it("signale le dernier prélèvement réel d'un autre montant, avec l'échéance qu'il remplace", () => {
    const history = [tx("2026-10-05", -1599, "PRLV NETFLIX.COM"), tx("2026-11-06", -1799, "PRLV NETFLIX.COM", { id: "last" })];
    expect(detectRuleDrifts(history, [rule], TODAY)).toEqual([{
      ruleId: "r1", ruleLabel: "Netflix", ruleAmountCents: -1599, transactionId: "last", date: "2026-11-06",
      observedAmountCents: -1799, increase: { fromCents: -1599, toCents: -1799, percent: 13 }, occurrence: "2026-11-05",
    }]);
  });

  it("ne dit rien si le dernier prélèvement est au bon montant, trop ancien, d'un autre compte ou d'un autre marchand", () => {
    expect(detectRuleDrifts([tx("2026-10-05", -1799, "PRLV NETFLIX"), tx("2026-11-05", -1599, "PRLV NETFLIX")], [rule], TODAY)).toEqual([]);
    expect(detectRuleDrifts([tx("2026-09-05", -1799, "PRLV NETFLIX")], [rule], TODAY)).toEqual([]);
    expect(detectRuleDrifts([tx("2026-11-05", -1799, "PRLV NETFLIX", { accountId: "a2" })], [rule], TODAY)).toEqual([]);
    expect(detectRuleDrifts([tx("2026-11-05", -1799, "PRLV SPOTIFY")], [rule], TODAY)).toEqual([]);
    expect(detectRuleDrifts([tx("2026-11-05", -1799, "PRLV NETFLIX")], [{ ...rule, label: "123" }], TODAY)).toEqual([]);
  });

  it("signale aussi une baisse (sans hausse), et ignore une opération loin de toute échéance", () => {
    const yearly: ExistingRule = { id: "r2", accountId: "a1", label: "Assurance auto", amountCents: -60000, frequency: "YEARLY", start: "2025-11-01" };
    expect(detectRuleDrifts([tx("2026-11-02", -55000, "PRLV ASSURANCE AUTO")], [yearly], TODAY)[0]).toMatchObject({ increase: null, occurrence: "2026-11-01" });
    expect(detectRuleDrifts([tx("2026-10-20", -55000, "PRLV ASSURANCE AUTO")], [yearly], TODAY)).toEqual([]);
  });
});
