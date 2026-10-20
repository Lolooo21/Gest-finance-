import { ALLOWED_HOSTS, type IndicatorSource } from "./indicators.js";
import { parseSdmxCsv } from "./sdmx-csv.js";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;

/** Lit une réponse en limitant sa taille (protège contre une réponse démesurée). */
async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Réponse trop volumineuse");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Extrait lisible (texte, 200 caractères) d'un corps de réponse d'erreur, pour le diagnostic. */
const snippet = (body: string) => body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

async function fetchOne(url: URL, indicator: IndicatorSource, fetchImpl: typeof fetch) {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.includes(url.hostname)) throw new Error("Hôte non autorisé");
  const res = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Pas d'en-tête Accept restrictif : le format est choisi par le paramètre `format` de l'URL
    // (Eurostat répond 406 si Accept: text/csv contredit format=SDMX-CSV).
    headers: { Accept: "*/*", "User-Agent": "Gest-finance (indicateurs publics)" },
  });
  if (!res.ok) {
    const detail = snippet(await readLimited(res).catch(() => ""));
    throw new Error(`Réponse HTTP ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  const { period, value } = parseSdmxCsv(await readLimited(res));
  const valueBp = Math.round(value * 100);
  if (valueBp < indicator.minBp || valueBp > indicator.maxBp) throw new Error(`Valeur invraisemblable (${value} %)`);
  return { period, value, valueBp };
}

/**
 * Télécharge et valide la dernière valeur d'un indicateur public, en essayant ses adresses dans l'ordre.
 * Garde-fous : URL constantes en https sur un hôte autorisé, aucune redirection suivie, délai de 10 s,
 * réponse limitée à 1 Mo, valeur hors bornes de vraisemblance rejetée, aucun cookie ni identifiant envoyé.
 * Renvoie aussi l'adresse qui a répondu ; si toutes échouent, l'erreur résume chaque tentative.
 */
export async function fetchIndicator(indicator: IndicatorSource, fetchImpl: typeof fetch = fetch): Promise<{ period: string; value: number; valueBp: number; url: string }> {
  const failures: string[] = [];
  for (const raw of indicator.urls) {
    const url = new URL(raw);
    try {
      return { ...(await fetchOne(url, indicator, fetchImpl)), url: raw };
    } catch (e) {
      failures.push(`${url.hostname}${url.pathname} : ${e instanceof Error ? e.message : "erreur inconnue"}`);
    }
  }
  // Une seule adresse : on garde le message simple ; sinon on détaille chaque tentative.
  throw new Error(indicator.urls.length === 1 ? failures[0]!.split(" : ").slice(1).join(" : ") : failures.join(" | "));
}
