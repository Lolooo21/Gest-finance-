import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, monthRange, parseEuros, todayIso } from "./money";

describe("parseEuros", () => {
  it.each([["12,50", 1250], ["12.5", 1250], ["1 000", 100_000], ["0,01", 1]])("convertit %s", (input, cents) => {
    expect(parseEuros(input)).toBe(cents);
  });
  it.each(["", "abc", "0", "-5", "1,234", "12,5,0", "99999999999"])("rejette « %s »", (input) => {
    expect(parseEuros(input)).toBeNull();
  });
});

describe("dates et formats", () => {
  it("donne les bornes du mois, y compris en année bissextile", () => {
    expect(monthRange(new Date(2026, 9, 15))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange(new Date(2028, 1, 10))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("formate les dates et les euros", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatCents(123_456).replace(/\s/g, " ")).toContain("1 234,56");
  });
});

describe("centsToInput", () => {
  it("préremplit un montant saisissable, sans signe", () => {
    expect(centsToInput(-4550)).toBe("45,50");
    expect(centsToInput(5)).toBe("0,05");
    expect(parseEuros(centsToInput(-4550))).toBe(4550);
  });
});

import { urlBase64ToUint8Array } from "./push";

describe("urlBase64ToUint8Array", () => {
  it("décode une clé VAPID en base64 url", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

import { detected } from "./pages/Payslip";

describe("detected", () => {
  it("indique ce qui manque dans la lecture d'une fiche", () => {
    const r = detected({ netToPayCents: null, grossCents: 312_050, periodMonth: null, employer: "ACME", confidence: 0.3, warnings: [] });
    expect(r.filter((d) => !d.found).map((d) => d.name)).toEqual(["Net à payer", "Période"]);
    expect(r.filter((d) => d.found).map((d) => d.name)).toEqual(["Brut", "Employeur"]);
  });
});

import { formatBp, formatDateFr, parseAmountOrZero, parsePercentToBp } from "./money";

describe("saisies et formats du simulateur", () => {
  it("accepte zéro et le champ vide pour un montant optionnel", () => {
    expect(parseAmountOrZero("")).toBe(0);
    expect(parseAmountOrZero(" 0 ")).toBe(0);
    expect(parseAmountOrZero("0,00")).toBe(0);
    expect(parseAmountOrZero("1 000")).toBe(100_000);
    expect(parseAmountOrZero("abc")).toBeNull();
    expect(parseAmountOrZero("-5")).toBeNull();
  });

  it("convertit un pourcentage en points de base", () => {
    expect(parsePercentToBp("1,7")).toBe(170);
    expect(parsePercentToBp("2.5")).toBe(250);
    expect(parsePercentToBp("0")).toBe(0);
    expect(parsePercentToBp("20")).toBe(2000);
    for (const bad of ["", "abc", "21", "1,234", "-1"]) expect(parsePercentToBp(bad)).toBeNull();
  });

  it("formate les taux et les dates en français", () => {
    expect(formatBp(170)).toBe("1,70 %");
    expect(formatBp(5)).toBe("0,05 %");
    expect(formatDateFr("2027-02-01")).toBe("1 février 2027");
  });
});
