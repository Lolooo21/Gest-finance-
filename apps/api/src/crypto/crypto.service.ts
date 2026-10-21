import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AUTH_TAG_BYTES = 16;

/** Chiffrement applicatif AES-256-GCM des champs sensibles (IBAN...). Clé : FIELD_ENCRYPTION_KEY (32 octets en base64 ou 64 hex). */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.FIELD_ENCRYPTION_KEY ?? "";
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY doit faire 32 octets (base64 ou 64 caractères hexadécimaux)");
    this.key = key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv, { authTagLength: AUTH_TAG_BYTES });
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
  }

  decrypt(payload: string): string {
    const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !data) throw new Error("Données chiffrées invalides");
    if (tag.length !== AUTH_TAG_BYTES) throw new Error("Données chiffrées invalides");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}
