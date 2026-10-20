/**
 * Diagnostic LOCAL des indicateurs de marché : effectue les vrais appels à la BCE et à Eurostat et affiche
 * le résultat. Rien n'est enregistré, aucune donnée de votre foyer n'est envoyée.
 *
 *   pnpm market:check
 */
import { fetchIndicator } from "../src/market/fetch-indicator.js";
import { INDICATORS } from "../src/market/indicators.js";
import { currentPelRate, currentRegulatedRates } from "../src/market/regulated-rates.js";

const pct = (bp: number) => `${(bp / 100).toFixed(2).replace(".", ",")} %`;
let failures = 0;

for (const indicator of INDICATORS) {
  try {
    const r = await fetchIndicator(indicator);
    console.log(`✓ ${indicator.label} : ${pct(r.valueBp)} (période ${r.period})`);
    console.log(`  Source utilisée : ${r.url}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${indicator.label} : ${e instanceof Error ? e.message : e}`);
    for (const url of indicator.urls) console.log(`  URL testée : ${url}`);
  }
}

const { current, stale } = currentRegulatedRates(new Date());
console.log(`\nTaux réglementés en configuration (du ${current.validFrom} au ${current.validTo})${stale ? " : PÉRIMÉS, à mettre à jour" : ""}`);
console.log(`  Livret A ${pct(current.livretABp)} · LDDS ${pct(current.lddsBp)} · LEP ${pct(current.lepBp)} · PEL ${pct(currentPelRate(new Date())?.rateBp ?? 0)}`);
console.log(`  Source : ${current.sourceUrl}`);
if (failures) {
  console.log(`\n${failures} indicateur(s) indisponible(s) : vérifiez votre accès Internet (pare-feu, proxy) ou signalez l'URL en erreur.`);
  process.exit(1);
}
