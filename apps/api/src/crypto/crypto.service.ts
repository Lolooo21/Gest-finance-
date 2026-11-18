import { Injectable } from "@nestjs/common";
import { decryptString, encryptString, loadFieldKey } from "./field-cipher.js";

/** Chiffrement applicatif AES-256-GCM des champs sensibles (IBAN...). Clé : FIELD_ENCRYPTION_KEY (32 octets en base64 ou 64 hex). */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    this.key = loadFieldKey();
  }

  encrypt(plain: string): string {
    return encryptString(this.key, plain);
  }

  decrypt(payload: string): string {
    return decryptString(this.key, payload);
  }
}
