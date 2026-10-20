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

describe("PDF français réels : espaces insécables et mises en page variées", () => {
  it("lit les montants écrits avec des espaces insécables et fines insécables", () => {
    const r = parsePayslip("Net à payer avant impôt : 2 430,40\nNet payé 2 285,40\nSalaire brut 3 120,50\nPériode : mars 2026");
    expect(r).toMatchObject({ netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-03" });
  });

  it("lit « Net à payer en euros » et les colonnes très espacées", () => {
    const r = parsePayslip("NET A PAYER EN EUROS          1 478,12\nTOTAL BRUT                    1 890,00\nMois : 02/2026");
    expect(r).toMatchObject({ netToPayCents: 147_812, grossCents: 189_000, periodMonth: "2026-02" });
  });

  it("lit une plage de dates sans le mot « période », avec tiret ou « au »", () => {
    expect(parsePayslip("Du 01/03/2026 au 31/03/2026\nNet payé 1 000,00").periodMonth).toBe("2026-03");
    expect(parsePayslip("01/04/2026 - 30/04/2026 Net payé 1 000,00").periodMonth).toBe("2026-04");
    expect(parsePayslip("Contrat du 01/01/2020 au 31/12/2026 Net payé 1 000,00").periodMonth).toBeNull();
  });

  it("lit le mois en lettres avec tiret ou barre, et la rémunération brute", () => {
    expect(parsePayslip("Bulletin de salaire — Janvier-2026\nRémunération brute 2 000,00\nNet à payer 1 600,00")).toMatchObject({ periodMonth: "2026-01", grossCents: 200_000, netToPayCents: 160_000 });
  });

  it("propose l'employeur depuis une ligne portant une forme juridique quand aucun libellé n'existe", () => {
    expect(parsePayslip("ACME CONSEIL SAS\n12 rue des Lilas\nNet payé 1 000,00").employer).toBe("ACME CONSEIL SAS");
    expect(parsePayslip("Net payé 1 000,00").employer).toBeNull();
  });

  it("préfère « Net payé » (après impôt) et ignore « Net imposable » et « Net social »", () => {
    const r = parsePayslip("Net social 2 600,00\nNet imposable 2 500,00\nNet à payer avant impôt 2 430,40\nNet payé 2 285,40");
    expect(r.netToPayCents).toBe(228_540);
  });
});
