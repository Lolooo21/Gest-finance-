import { describe, expect, it } from "vitest";
import { rebuildLines } from "../src/payslip/pdf-text.js";

const item = (str: string, x: number, y: number, width = str.length * 6) => ({ str, transform: [1, 0, 0, 1, x, y], width });

describe("rebuildLines", () => {
  it("regroupe par ligne (y) et ordonne par colonne (x), quel que soit l'ordre d'écriture", () => {
    const text = rebuildLines([item("2 285,40", 400, 640), item("Net payé", 40, 640), item("Brut", 40, 700), item("3 120,50", 400, 700)]);
    expect(text).toBe("Brut 3 120,50\nNet payé 2 285,40");
  });

  it("tolère un léger écart vertical et recolle sans espace les fragments contigus", () => {
    expect(rebuildLines([item("Net", 10, 500, 18), item("payé", 32, 499.2, 24), item("1", 200, 500, 6), item("234,50", 206, 500, 36)])).toBe("Net payé 1234,50");
  });

  it("ignore les fragments vides", () => {
    expect(rebuildLines([item(" ", 10, 10), item("", 20, 10), item("A", 30, 10)])).toBe("A");
  });
});
