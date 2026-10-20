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
