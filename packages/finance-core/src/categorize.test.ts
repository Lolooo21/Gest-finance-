import { describe, expect, it } from "vitest";
import {
  classify, labelPattern, matchRule, normalizePattern, patternMatches, significantTokens, suggestCategory, trainClassifier,
  type CategoryRuleInput,
} from "./index.js";

describe("mots-clés des libellés bancaires", () => {
  it("retire le bruit bancaire, les chiffres et les mots courts", () => {
    expect(significantTokens("CB CARREFOUR EVRY 12/11")).toEqual(["carrefour", "evry"]);
    expect(significantTokens("PRLV SEPA FREE MOBILE REF 123ABC")).toEqual(["free", "mobile"]);
    expect(labelPattern("VIR SEPA RECU SALAIRE ACME NOVEMBRE")).toBe("salaire");
    expect(labelPattern("CB 12/11 DAB")).toBeNull();
    expect(normalizePattern("  Free Mobile ")).toBe("free mobile");
  });

  it("ne reconnaît que des mots entiers", () => {
    expect(patternMatches("free", "PRLV FREE MOBILE")).toBe(true);
    expect(patternMatches("free mobile", "prlv Free  Mobile 03")).toBe(true);
    expect(patternMatches("free", "FREEBOX")).toBe(false);
    expect(patternMatches("", "x")).toBe(false);
  });
});

describe("règles", () => {
  const rules: CategoryRuleInput[] = [
    { id: "r1", pattern: "carrefour", categoryId: "courses", source: "LEARNED", hits: 9 },
    { id: "r2", pattern: "carrefour", categoryId: "maison", source: "MANUAL", hits: 0 },
    { id: "r3", pattern: "free", categoryId: "telecom", source: "LEARNED", hits: 1 },
    { id: "r4", pattern: "free mobile", categoryId: "mobile", source: "LEARNED", hits: 1 },
    { id: "r5", pattern: "amazon", categoryId: "achats", source: "LEARNED", hits: 1 },
    { id: "r6", pattern: "amazon", categoryId: "loisirs", source: "LEARNED", hits: 4 },
  ];

  it("préfère une règle saisie, puis le mot-clé le plus long, puis la plus utilisée", () => {
    expect(matchRule("CB CARREFOUR MASSY", rules)?.id).toBe("r2");
    expect(matchRule("PRLV FREE MOBILE", rules)?.id).toBe("r4");
    expect(matchRule("PRLV FREE TELECOM", rules)?.id).toBe("r3");
    expect(matchRule("CB AMAZON PAYMENTS", rules)?.id).toBe("r6");
    expect(matchRule("CB LIDL", rules)).toBeNull();
  });
});

describe("classifieur bayésien naïf", () => {
  const history = [
    { label: "CB LECLERC DRIVE", categoryId: "courses" },
    { label: "CB LECLERC STATION", categoryId: "courses" },
    { label: "CB AUCHAN SUPERMARCHE", categoryId: "courses" },
    { label: "CB CINEMA PATHE", categoryId: "loisirs" },
    { label: "CB PATHE BOUTIQUE", categoryId: "loisirs" },
    { label: "CB BOWLING CENTRE", categoryId: "loisirs" },
    { label: "CB 1234", categoryId: "loisirs" },
  ];

  it("s'entraîne sur l'historique en ignorant les libellés sans mot significatif", () => {
    const model = trainClassifier(history);
    expect(model.examples).toBe(6);
    expect(model.docs).toEqual({ courses: 3, loisirs: 3 });
    expect(model.words.courses!.leclerc).toBe(2);
  });

  it("classe un libellé proche, et s'abstient quand il ne sait pas", () => {
    const model = trainClassifier(history);
    expect(classify(model, "CB LECLERC MARKET")).toMatchObject({ categoryId: "courses" });
    expect(classify(model, "CB LECLERC MARKET")!.probability).toBeGreaterThanOrEqual(0.6);
    expect(classify(model, "CB PATHE CINEMA")?.categoryId).toBe("loisirs");
    // Aucun mot connu, mots ambigus ou libellé vide : pas de proposition.
    expect(classify(model, "CB INCONNU TOTAL")).toBeNull();
    expect(classify(model, "CB 99")).toBeNull();
    const ambiguous = trainClassifier([...history, { label: "LECLERC BOWLING", categoryId: "loisirs" }, { label: "PATHE AUCHAN", categoryId: "courses" }]);
    expect(classify(ambiguous, "LECLERC PATHE")).toBeNull();
  });

  it("attend assez d'exemples", () => {
    expect(classify(trainClassifier(history.slice(0, 4)), "CB LECLERC")).toBeNull();
    expect(classify(trainClassifier([]), "CB LECLERC")).toBeNull();
  });
});

describe("proposition de catégorie", () => {
  const rules: CategoryRuleInput[] = [{ id: "r1", pattern: "edf", categoryId: "energie", source: "MANUAL", hits: 0 }];
  const model = trainClassifier([
    { label: "LECLERC", categoryId: "courses" }, { label: "LECLERC DRIVE", categoryId: "courses" }, { label: "AUCHAN", categoryId: "courses" },
    { label: "PATHE", categoryId: "loisirs" }, { label: "BOWLING", categoryId: "loisirs" },
  ]);

  it("utilise la règle, puis le classifieur, sinon rien", () => {
    expect(suggestCategory("PRLV EDF CLIENTS", rules, model)).toEqual({ categoryId: "energie", source: "RULE", ruleId: "r1" });
    expect(suggestCategory("CB LECLERC", rules, model)).toEqual({ categoryId: "courses", source: "MODEL" });
    expect(suggestCategory("CB INCONNU", rules, model)).toBeNull();
    expect(suggestCategory("CB LECLERC", [], null)).toBeNull();
  });
});
