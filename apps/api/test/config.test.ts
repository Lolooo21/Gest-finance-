import { describe, expect, it } from "vitest";
import { assertProductionConfig, EXAMPLE_SECRETS } from "../src/config.js";
import { loadSecretsFromFiles } from "../src/secrets.js";

const good = { NODE_ENV: "production", JWT_SECRET: "x".repeat(48), FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), DATABASE_URL: "postgresql://u:p@db/x", DATABASE_SYSTEM_URL: "postgresql://s:p@db/x" };

describe("loadSecretsFromFiles", () => {
  const files: Record<string, string> = { "/run/secrets/jwt": "  secret-jwt-value  \n", "/run/secrets/empty": " \n" };
  const read = (p: string) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p]!;
  };

  it("charge les variables *_FILE sans espaces parasites et renvoie seulement les noms", () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_FILE: "/run/secrets/jwt" };
    expect(loadSecretsFromFiles(env, read)).toEqual(["JWT_SECRET"]);
    expect(env.JWT_SECRET).toBe("secret-jwt-value");
  });

  it("n'écrase jamais une variable déjà définie et ignore les *_FILE absentes", () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET: "déjà-là", JWT_SECRET_FILE: "/run/secrets/jwt" };
    expect(loadSecretsFromFiles(env, read)).toEqual([]);
    expect(env.JWT_SECRET).toBe("déjà-là");
    expect(loadSecretsFromFiles({}, read)).toEqual([]);
  });

  it("échoue clairement si le fichier est illisible ou vide, sans afficher de valeur", () => {
    expect(() => loadSecretsFromFiles({ DATABASE_URL_FILE: "/absent" }, read)).toThrow("Secret illisible : DATABASE_URL_FILE");
    expect(() => loadSecretsFromFiles({ FIELD_ENCRYPTION_KEY_FILE: "/run/secrets/empty" }, read)).toThrow("Secret vide");
  });
});

describe("assertProductionConfig", () => {
  it("ne contrôle rien hors production", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionConfig({})).not.toThrow();
  });

  it("accepte une configuration de production complète", () => {
    expect(() => assertProductionConfig(good)).not.toThrow();
  });

  it("refuse les secrets absents, courts, d'exemple ou invalides, en listant tous les problèmes", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production" })).toThrow(/JWT_SECRET.*FIELD_ENCRYPTION_KEY.*DATABASE_URL.*DATABASE_SYSTEM_URL/);
    expect(() => assertProductionConfig({ ...good, JWT_SECRET: "court" })).toThrow(/32 caractères/);
    expect(() => assertProductionConfig({ ...good, JWT_SECRET: EXAMPLE_SECRETS[0]! })).toThrow(/valeur d'exemple/);
    expect(() => assertProductionConfig({ ...good, FIELD_ENCRYPTION_KEY: EXAMPLE_SECRETS[1]! })).toThrow(/FIELD_ENCRYPTION_KEY est la valeur d'exemple/);
    expect(() => assertProductionConfig({ ...good, FIELD_ENCRYPTION_KEY: "trop-court" })).toThrow(/32 octets/);
  });

  it("interdit les cookies non sécurisés en production", () => {
    expect(() => assertProductionConfig({ ...good, DATABASE_OWNER_URL: "postgresql://gest:p@db/x" })).toThrow(/DATABASE_OWNER_URL ne doit pas être défini/);
    expect(() => assertProductionConfig({ ...good, COOKIE_SECURE: "0" })).toThrow(/COOKIE_SECURE=0 est interdit/);
    expect(() => assertProductionConfig({ ...good, COOKIE_SECURE: "0", ALLOW_INSECURE_COOKIES: "1" })).not.toThrow();
  });

  it("n'inclut jamais la valeur d'un secret dans le message d'erreur", () => {
    try {
      assertProductionConfig({ ...good, JWT_SECRET: "tres-secret-tres-secret-" });
    } catch (e) {
      expect((e as Error).message).not.toContain("tres-secret");
    }
  });
});
