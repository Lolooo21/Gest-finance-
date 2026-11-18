import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement applicatif AES-256-GCM des champs texte sensibles, transparent pour le code de l'API.
 *
 * Champs chiffrés en base : libellés des opérations et des récurrences (`label`), employeur des fiches de paie (`employer`) et
 * note des versements d'épargne (`note`). Un nom de champ ne désigne qu'un de ces usages dans le schéma : le chiffrement se fait
 * par nom de champ, à toute profondeur (relations incluses). Les montants et les dates restent en clair, car PostgreSQL les additionne et les
 * trie ; ils sont protégés par la RLS, les droits des rôles et les sauvegardes chiffrées.
 *
 * Format : `enc1:` + iv.tag.données (base64). Une valeur sans préfixe est lue telle quelle : ce sont les données d'avant
 * le chiffrement, que `scripts/encrypt-fields.ts` chiffre au déploiement.
 */
export const ENCRYPTED_PREFIX = "enc1:";
export const SENSITIVE_FIELDS: ReadonlySet<string> = new Set(["label", "employer", "note"]);

const AUTH_TAG_BYTES = 16;
const WRITE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert"]);

/** Clé de `FIELD_ENCRYPTION_KEY` : 32 octets, en base64 ou en 64 caractères hexadécimaux. */
export function loadFieldKey(raw = process.env.FIELD_ENCRYPTION_KEY ?? ""): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY doit faire 32 octets (base64 ou 64 caractères hexadécimaux)");
  return key;
}

export function encryptString(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptString(key: Buffer, payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data || tag.length !== AUTH_TAG_BYTES) throw new Error("Données chiffrées invalides");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !(v instanceof Date) && !(v instanceof Uint8Array) && !Array.isArray(v);

export class FieldCipher {
  constructor(private readonly key: Buffer = loadFieldKey()) {}

  encryptField(value: string): string {
    return value.startsWith(ENCRYPTED_PREFIX) ? value : ENCRYPTED_PREFIX + encryptString(this.key, value);
  }

  decryptField(value: string): string {
    return value.startsWith(ENCRYPTED_PREFIX) ? decryptString(this.key, value.slice(ENCRYPTED_PREFIX.length)) : value;
  }

  /** Données à écrire : chaque champ sensible est chiffré, y compris dans les créations imbriquées et les listes. */
  private encryptData(data: unknown): unknown {
    if (Array.isArray(data)) return data.map((d) => this.encryptData(d));
    if (!isPlainObject(data)) return data;
    return Object.fromEntries(Object.entries(data).map(([k, v]) => {
      if (SENSITIVE_FIELDS.has(k)) {
        if (typeof v === "string") return [k, this.encryptField(v)];
        if (isPlainObject(v) && typeof v.set === "string") return [k, { ...v, set: this.encryptField(v.set) }];
        return [k, v];
      }
      return [k, this.encryptData(v)];
    }));
  }

  /** Arguments d'une opération Prisma : seules `data`, `create` et `update` (écritures) sont chiffrées, jamais les filtres. */
  encryptArgs<T>(operation: string, args: T): T {
    if (!WRITE_OPERATIONS.has(operation) || !isPlainObject(args)) return args;
    const out: Record<string, unknown> = { ...args };
    for (const k of ["data", "create", "update"]) if (k in out) out[k] = this.encryptData(out[k]);
    return out as T;
  }

  /** Résultat d'une requête : champs sensibles déchiffrés à toute profondeur (relations incluses). */
  decryptResult<T>(result: T): T {
    if (Array.isArray(result)) return result.map((r) => this.decryptResult(r)) as T;
    if (!isPlainObject(result)) return result;
    return Object.fromEntries(Object.entries(result).map(([k, v]) =>
      [k, SENSITIVE_FIELDS.has(k) && typeof v === "string" ? this.decryptField(v) : this.decryptResult(v)])) as T;
  }

  /**
   * Client de transaction interactive dont chaque délégué de modèle (`tx.transaction.create`…) chiffre et déchiffre comme le
   * client principal. Les méthodes `$…` (requêtes brutes) passent telles quelles.
   */
  wrap<T extends object>(client: T): T {
    return new Proxy(client, {
      get: (target, prop, receiver) => {
        const delegate: unknown = Reflect.get(target, prop, receiver);
        if (typeof prop !== "string" || prop.startsWith("$") || typeof delegate !== "object" || delegate === null) return delegate;
        return new Proxy(delegate, {
          get: (d, op) => {
            const fn: unknown = Reflect.get(d, op);
            if (typeof fn !== "function" || typeof op !== "string") return fn;
            return async (args?: unknown) => this.decryptResult(await (fn as (a?: unknown) => Promise<unknown>).call(d, this.encryptArgs(op, args)));
          },
        });
      },
    });
  }
}
