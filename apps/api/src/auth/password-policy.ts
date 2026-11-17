/**
 * Politique de mot de passe, en plus des 12 caractères minimum du schéma : refuse les mots de passe faits d'un mot très
 * courant (avec ou sans chiffres autour), uniquement de chiffres, trop répétitifs, ou qui reprennent le nom, l'e-mail ou le
 * foyer. Tout est vérifié sur le serveur, sans service externe.
 */
const COMMON = new Set([
  "motdepasse", "password", "passw", "azerty", "azertyuiop", "qwerty", "qwertyuiop", "soleil", "bonjour", "doudou", "loulou",
  "chouchou", "jetaime", "iloveyou", "princesse", "marseille", "paris", "football", "admin", "administrateur", "welcome",
  "bienvenue", "secret", "monsecret", "gestfinance", "finance", "finances", "banque", "famille", "maison", "letmein", "abcdef",
]);

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Mots d'au moins 4 lettres tirés du contexte (partie locale de l'e-mail, nom, foyer). */
function contextWords(context: string[]): string[] {
  return context.flatMap((c) => normalize(c.split("@")[0]!).split(/[^a-z0-9]+/)).filter((w) => w.length >= 4);
}

/** Raison du refus, en français, ou null si le mot de passe est acceptable. */
export function passwordProblem(password: string, context: string[] = []): string | null {
  const p = normalize(password);
  const letters = p.replace(/[^a-z]/g, "");
  if (/^\d+$/.test(p)) return "Mot de passe trop simple : pas uniquement des chiffres";
  if (new Set(p).size < 5) return "Mot de passe trop simple : trop de caractères répétés";
  if (COMMON.has(letters)) return "Mot de passe trop courant : choisissez une phrase de plusieurs mots";
  const reused = contextWords(context).find((w) => p.includes(w));
  if (reused) return "Le mot de passe ne doit pas reprendre votre nom, votre e-mail ou le nom du foyer";
  return null;
}
