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

/**
 * Télécharge et valide la dernière valeur d'un indicateur public.
 * Garde-fous : URL constante en https sur un hôte autorisé, aucune redirection suivie, délai de 10 s,
 * réponse limitée à 1 Mo, valeur hors bornes de vraisemblance rejetée, aucun cookie ni identifiant envoyé.
 */
export async function fetchIndicator(indicator: IndicatorSource, fetchImpl: typeof fetch = fetch): Promise<{ period: string; value: number; valueBp: number }> {
  const url = new URL(indicator.url);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.includes(url.hostname)) throw new Error("Hôte non autorisé");
  const res = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "text/csv", "User-Agent": "Gest-finance (indicateurs publics)" },
  });
  if (!res.ok) throw new Error(`Réponse HTTP ${res.status}`);
  const { period, value } = parseSdmxCsv(await readLimited(res));
  const valueBp = Math.round(value * 100);
  if (valueBp < indicator.minBp || valueBp > indicator.maxBp) throw new Error(`Valeur invraisemblable (${value} %)`);
  return { period, value, valueBp };
}
