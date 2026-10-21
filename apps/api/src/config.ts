/** Valeurs d'exemple de `.env.example` : acceptables en développement, interdites en production. */
export const EXAMPLE_SECRETS = ["dev-secret-dev-secret-dev-secret-123456", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="];

/** En production, refuse de démarrer avec une configuration absente, trop faible ou recopiée de l'exemple. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems: string[] = [];

  const jwt = env.JWT_SECRET ?? "";
  if (jwt.length < 32) problems.push("JWT_SECRET absent ou de moins de 32 caractères");
  if (EXAMPLE_SECRETS.includes(jwt)) problems.push("JWT_SECRET est la valeur d'exemple");

  const key = env.FIELD_ENCRYPTION_KEY ?? "";
  const raw = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
  if (raw.length !== 32) problems.push("FIELD_ENCRYPTION_KEY absente ou invalide (32 octets attendus)");
  if (EXAMPLE_SECRETS.includes(key)) problems.push("FIELD_ENCRYPTION_KEY est la valeur d'exemple");

  if (!env.DATABASE_URL) problems.push("DATABASE_URL absente");
  if (env.COOKIE_SECURE === "0" && env.ALLOW_INSECURE_COOKIES !== "1") problems.push("COOKIE_SECURE=0 est interdit en production");

  if (problems.length) throw new Error(`Configuration de production invalide : ${problems.join(" ; ")}.`);
}
