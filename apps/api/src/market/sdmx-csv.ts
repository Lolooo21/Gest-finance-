export interface Observation {
  /** Période de la source : "2026-09", "2026-10-15"… */
  period: string;
  value: number;
}

/** Découpe une ligne CSV en gérant les guillemets (`"a,b",c`) et les guillemets doublés. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/**
 * Dernière observation d'un export SDMX-CSV (BCE `format=csvdata`, Eurostat `format=SDMX-CSV`) :
 * colonnes `TIME_PERIOD` et `OBS_VALUE`. Les lignes sans valeur numérique sont ignorées.
 * Lève une erreur claire si le format n'est pas celui attendu.
 */
export function parseSdmxCsv(csv: string): Observation {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.length ? splitCsvLine(lines[0]!).map((h) => h.trim()) : [];
  const periodIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (periodIdx < 0 || valueIdx < 0) throw new Error("Format inattendu : colonnes TIME_PERIOD / OBS_VALUE absentes");

  let best: Observation | null = null;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const period = cells[periodIdx]?.trim();
    const raw = cells[valueIdx]?.trim();
    if (!period || !raw || !/^-?\d+(\.\d+)?$/.test(raw)) continue;
    // Les périodes ISO ("2026-09", "2026-10-15") se comparent lexicographiquement.
    if (!best || period > best.period) best = { period, value: Number(raw) };
  }
  if (!best) throw new Error("Aucune observation numérique dans la réponse");
  return best;
}
