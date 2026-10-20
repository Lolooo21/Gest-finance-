import { describe, expect, it } from "vitest";
import { CryptoService } from "../src/crypto/crypto.service.js";

describe("CryptoService", () => {
  it("chiffre puis déchiffre, avec un IV aléatoire", () => {
    const c = new CryptoService();
    const a = c.encrypt("FR7630006000011234567890189");
    expect(a).not.toContain("FR76");
    expect(c.encrypt("FR7630006000011234567890189")).not.toBe(a);
    expect(c.decrypt(a)).toBe("FR7630006000011234567890189");
  });

  it("détecte une altération des données", () => {
    const c = new CryptoService();
    const [iv, tag, data] = c.encrypt("secret").split(".");
    const tampered = [iv, tag, Buffer.from("autre-chose").toString("base64")].join(".");
    expect(() => c.decrypt(tampered)).toThrow();
    expect(data).toBeTruthy();
  });

  it("refuse une clé de mauvaise taille", () => {
    const saved = process.env.FIELD_ENCRYPTION_KEY;
    process.env.FIELD_ENCRYPTION_KEY = "trop-court";
    expect(() => new CryptoService()).toThrow(/32 octets/);
    process.env.FIELD_ENCRYPTION_KEY = saved;
  });
});
