import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ENCRYPTED_PREFIX, FieldCipher, loadFieldKey } from "../src/crypto/field-cipher.js";

const cipher = new FieldCipher(randomBytes(32));

describe("chiffrement des champs sensibles", () => {
  it("chiffre avec un IV aléatoire, déchiffre, et laisse passer une valeur d'avant le chiffrement", () => {
    const a = cipher.encryptField("Loyer Mme Dupont");
    const b = cipher.encryptField("Loyer Mme Dupont");
    expect(a.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(a).not.toContain("Dupont");
    expect(a).not.toBe(b);
    expect(cipher.decryptField(a)).toBe("Loyer Mme Dupont");
    expect(cipher.encryptField(a)).toBe(a); // déjà chiffré : inchangé
    expect(cipher.decryptField("ancien libellé en clair")).toBe("ancien libellé en clair");
    expect(cipher.decryptField(cipher.encryptField(""))).toBe("");
  });

  it("refuse une valeur altérée ou une autre clé (AES-GCM authentifié)", () => {
    const value = cipher.encryptField("Salaire");
    const tampered = value.slice(0, -2) + (value.endsWith("A") ? "B" : "A") + "=";
    expect(() => cipher.decryptField(tampered)).toThrow();
    expect(() => new FieldCipher(randomBytes(32)).decryptField(value)).toThrow();
    expect(() => cipher.decryptField(`${ENCRYPTED_PREFIX}abc`)).toThrow();
  });

  it("ne chiffre que les écritures, à toute profondeur, jamais les filtres", () => {
    const create = cipher.encryptArgs("create", {
      data: { label: "Salaire", amountCents: 100, payslipImport: { create: { employer: "ACME", periodMonth: "2026-11" } } },
    }) as { data: { label: string; amountCents: number; payslipImport: { create: { employer: string; periodMonth: string } } } };
    expect(create.data.label.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(create.data.amountCents).toBe(100);
    expect(create.data.payslipImport.create.employer.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(create.data.payslipImport.create.periodMonth).toBe("2026-11");

    const many = cipher.encryptArgs("createMany", { data: [{ label: "A" }, { label: "B", note: null }] }) as { data: { label: string; note?: null }[] };
    expect(many.data.map((d) => cipher.decryptField(d.label))).toEqual(["A", "B"]);
    expect(many.data[1]!.note).toBeNull();

    const update = cipher.encryptArgs("update", { where: { label: "filtre" }, data: { label: { set: "Nouveau" } } }) as { where: { label: string }; data: { label: { set: string } } };
    expect(update.where.label).toBe("filtre");
    expect(cipher.decryptField(update.data.label.set)).toBe("Nouveau");

    const upsert = cipher.encryptArgs("upsert", { where: { id: "x" }, create: { note: "n1" }, update: { note: "n2" } }) as { create: { note: string }; update: { note: string } };
    expect([cipher.decryptField(upsert.create.note), cipher.decryptField(upsert.update.note)]).toEqual(["n1", "n2"]);

    const read = { where: { label: "x" } };
    expect(cipher.encryptArgs("findMany", read)).toBe(read);
  });

  it("déchiffre les résultats, relations et listes comprises, sans toucher aux dates ni aux octets", () => {
    const date = new Date("2026-11-19");
    const bytes = new Uint8Array([1, 2]);
    const out = cipher.decryptResult([
      { label: cipher.encryptField("Courses"), date, key: bytes, account: { name: "Joint" } },
      { employer: cipher.encryptField("ACME"), transaction: { label: cipher.encryptField("Salaire") }, contributions: [{ note: cipher.encryptField("Prime") }] },
    ]);
    expect(out).toEqual([
      { label: "Courses", date, key: bytes, account: { name: "Joint" } },
      { employer: "ACME", transaction: { label: "Salaire" }, contributions: [{ note: "Prime" }] },
    ]);
    expect(out[0]!.date).toBe(date);
    expect(cipher.decryptResult(null)).toBeNull();
    expect(cipher.decryptResult(3)).toBe(3);
  });

  it("exige une clé de 32 octets", () => {
    expect(() => loadFieldKey("trop-courte")).toThrow(/32 octets/);
    expect(loadFieldKey("0".repeat(64))).toHaveLength(32);
  });
});
