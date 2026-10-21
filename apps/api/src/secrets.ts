import { readFileSync } from "node:fs";

/** Variables qui peuvent être fournies par un fichier (secrets Docker) via `<NOM>_FILE`. */
export const SECRET_VARS = ["JWT_SECRET", "FIELD_ENCRYPTION_KEY", "DATABASE_URL", "VAPID_PRIVATE_KEY"] as const;

/**
 * Secrets Docker : si `JWT_SECRET_FILE=/run/secrets/jwt_secret` est défini, la valeur du fichier devient `JWT_SECRET`.
 * Une variable déjà renseignée n'est jamais écrasée. Les secrets ne passent ainsi ni par l'image, ni par la ligne de commande.
 * Renvoie les noms chargés (jamais les valeurs).
 */
export function loadSecretsFromFiles(env: NodeJS.ProcessEnv = process.env, read: (path: string) => string = (p) => readFileSync(p, "utf8")): string[] {
  const loaded: string[] = [];
  for (const name of SECRET_VARS) {
    const file = env[`${name}_FILE`];
    if (!file || env[name]) continue;
    let value: string;
    try {
      value = read(file).trim();
    } catch {
      throw new Error(`Secret illisible : ${name}_FILE pointe vers ${file}`);
    }
    if (!value) throw new Error(`Secret vide : le fichier de ${name}_FILE ne contient rien`);
    env[name] = value;
    loaded.push(name);
  }
  return loaded;
}
