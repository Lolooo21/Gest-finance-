import { describe, expect, it } from "vitest";
import { parseAmountCents, parsePayslip } from "./index.js";

const LAYOUT_A = `BULLETIN DE PAIE
Employeur : ACME Conseil SAS
Période du 01/03/2026 au 31/03/2026
Salaire brut 3 120,50
Total des cotisations 690,10
Net à payer avant impôt sur le revenu 2 430,40
Prélèvement à la source 145,00
Net payé 2 285,40 €`;

const LAYOUT_B = `Bulletin de paie
Raison sociale : Boulangerie Dupont
Mois de février 2026
Total brut : 1 890,00
Net à payer : 1 478,12 EUR`;

const LAYOUT_C = `Société : Mairie de Bastia
Bulletin de paie 07/2026
Brut mensuel 2.510,00
Net à payer avant impôt 1.990,35`;

describe("parseAmountCents", () => {
  it.each([["2 345,67", 234_567], ["1.234,50", 123_450], ["12,00", 1200], ["1,234.50", 123_450], ["0,05", 5], ["1 234 567,89", 123_456_789]])("convertit %s", (raw, cents) => {
    expect(parseAmountCents(raw)).toBe(cents);
  });
  it.each(["", "abc", "12", "12,5", "12,345", "99999999999,99", "1,2,3"])("rejette « %s »", (raw) => {
    expect(parseAmountCents(raw)).toBeNull();
  });
});

describe("parsePayslip", () => {
  it("lit une fiche avec prélèvement à la source : retient le net payé", () => {
    expect(parsePayslip(LAYOUT_A)).toEqual({
      netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-03", employer: "ACME Conseil SAS", confidence: 1, warnings: [],
    });
  });

  it("lit une autre mise en page (mois en toutes lettres, accents)", () => {
    expect(parsePayslip(LAYOUT_B)).toMatchObject({ netToPayCents: 147_812, grossCents: 189_000, periodMonth: "2026-02", employer: "Boulangerie Dupont", confidence: 1 });
  });

  it("signale le net avant impôt et lit les formats à points et MM/AAAA", () => {
    const r = parsePayslip(LAYOUT_C);
    expect(r).toMatchObject({ netToPayCents: 199_035, grossCents: 251_000, periodMonth: "2026-07", employer: "Mairie de Bastia" });
    expect(r.warnings.join(" ")).toContain("avant impôt");
  });

  it("n'invente rien : champs absents = null avec avertissements et confiance nulle", () => {
    const r = parsePayslip("Document sans rapport 12 rue des Lilas");
    expect(r).toMatchObject({ netToPayCents: null, grossCents: null, periodMonth: null, confidence: 0 });
    expect(r.warnings).toHaveLength(3);
  });

  it("signale un net supérieur au brut ou anormalement bas", () => {
    expect(parsePayslip("Salaire brut 1 000,00\nNet à payer 1 500,00").warnings.join(" ")).toContain("supérieur au brut");
    const low = parsePayslip("Salaire brut 3 000,00\nNet à payer 100,00");
    expect(low.warnings.join(" ")).toContain("très inférieur");
    expect(low.confidence).toBeLessThan(0.7);
  });

  it("ignore un mois de /AAAA invalide et garde la fin de la période", () => {
    expect(parsePayslip("Période 13/2026 Net à payer 100,00").periodMonth).toBeNull();
    expect(parsePayslip("Période du 15/12/2025 au 14/01/2026 Net à payer 100,00").periodMonth).toBe("2026-01");
  });
});
