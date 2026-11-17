import { occurrences, type RecurringRule } from "./recurrence.js";

/**
 * Import de relevés bancaires (CSV ou OFX) et rapprochement avec les données déjà saisies.
 * Fonctions pures : le texte est déjà décodé, montants en centimes signés (entrée +, sortie −), dates ISO AAAA-MM-JJ.
 */
export interface StatementLine {
  date: string;
  amountCents: number;
  label: string;
  /** Identifiant de l'opération fourni par la banque (OFX). */
  fitId?: string;
}

export interface ParsedStatement {
  format: "CSV" | "OFX";
  lines: StatementLine[];
  /** Lignes non vides ignorées (date ou montant illisible). */
  skipped: number;
  warnings: string[];
}

export const MAX_LABEL_LENGTH = 120;
const DAY_MS = 86_400_000;

/** Minuscules, sans accents ni ponctuation, espaces simples : sert à comparer libellés et en-têtes. */
export function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const cleanLabel = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH) || "Opération";

const isValidIso = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/** JJ/MM/AAAA, JJ/MM/AA, JJ-MM-AAAA, JJ.MM.AAAA, AAAA-MM-JJ ou AAAAMMJJ (OFX) ; null si la date n'existe pas. */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  let iso: string | null = null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    iso = `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) {
    iso = `${m[1]}-${m[2]}-${m[3]}`;
  } else if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(s))) {
    iso = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return iso && isValidIso(iso) ? iso : null;
}

/**
 * Montant en centimes : « -1 234,56 », « 12.50 », « +12,5 € », « −3,00 » (signe moins typographique).
 * Avec point et virgule, le dernier des deux est le séparateur décimal. Null si illisible ou plus de 2 décimales.
 */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.replace(/[\s  €]|EUR/g, "").replace(/[−–]/g, "-");
  if (s === "") return null;
  let sign = 1;
  if (s.startsWith("-")) { sign = -1; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimal = lastComma > lastDot ? "," : ".";
  const thousands = decimal === "," ? "." : ",";
  s = s.split(thousands).join("");
  const [int, frac = "", ...rest] = s.split(decimal);
  if (rest.length > 0 || !/^\d+$/.test(int ?? "") || !/^\d{0,2}$/.test(frac)) return null;
  const cents = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? sign * cents : null;
}

/** Découpe une ligne CSV en champs (guillemets doublés gérés). */
function splitCsvRow(row: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

interface Columns { date: number; label: number; amount: number; debit: number; credit: number }

/** Repère les colonnes utiles dans une ligne d'en-tête ; null si ce n'est pas un en-tête de relevé. */
function detectColumns(cells: string[]): Columns | null {
  const n = cells.map(normalizeLabel);
  const find = (...tests: ((h: string) => boolean)[]) => {
    for (const t of tests) {
      const i = n.findIndex(t);
      if (i >= 0) return i;
    }
    return -1;
  };
  const date = find((h) => h === "date", (h) => h.startsWith("date") && /operation|comptab/.test(h), (h) => h.startsWith("date") && !h.includes("valeur"), (h) => h.startsWith("date"));
  const amount = find((h) => h === "montant" || h === "amount", (h) => h.startsWith("montant"));
  const debit = find((h) => h.startsWith("debit"));
  const credit = find((h) => h.startsWith("credit"));
  const label = find((h) => /^(libelle|description|intitule|designation|detail)/.test(h), (h) => /libelle|description|intitule|nature|operation/.test(h) && !h.startsWith("date"));
  if (date < 0 || label < 0 || (amount < 0 && (debit < 0 || credit < 0))) return null;
  return { date, label, amount, debit, credit };
}

function parseCsv(text: string): ParsedStatement {
  const rows = text.split(/\r?\n/).filter((r) => r.trim() !== "");
  const sample = rows.slice(0, 20);
  const delimiter = [";", "\t", ","].reduce((best, d) => (count(sample, d) > count(sample, best) ? d : best), ";");
  const headerIndex = sample.findIndex((r) => detectColumns(splitCsvRow(r, delimiter)) !== null);
  if (headerIndex < 0) {
    return { format: "CSV", lines: [], skipped: 0, warnings: ["En-tête introuvable : le fichier doit contenir des colonnes Date, Libellé et Montant (ou Débit et Crédit)."] };
  }
  const cols = detectColumns(splitCsvRow(rows[headerIndex]!, delimiter))!;
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const cells = splitCsvRow(row, delimiter);
    const date = parseStatementDate(cells[cols.date] ?? "");
    let amountCents: number | null;
    if (cols.amount >= 0) {
      amountCents = parseStatementAmount(cells[cols.amount] ?? "");
    } else {
      const debit = parseStatementAmount(cells[cols.debit] ?? "");
      const credit = parseStatementAmount(cells[cols.credit] ?? "");
      amountCents = debit ? -Math.abs(debit) : credit ? Math.abs(credit) : null;
    }
    if (!date || !amountCents) { skipped++; continue; }
    lines.push({ date, amountCents, label: cleanLabel(cells[cols.label] ?? "") });
  }
  return { format: "CSV", lines, skipped, warnings: [] };
}

const count = (rows: string[], d: string) => rows.reduce((acc, r) => acc + r.split(d).length - 1, 0);

/** OFX 1.x (SGML, balises de champ non fermées) ou 2.x (XML). */
function parseOfx(text: string): ParsedStatement {
  const field = (block: string, tag: string) => new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim() ?? "";
  // Un seul passage : « &amp;lt; » doit donner « &lt; », pas « < » (pas de double décodage).
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", apos: "'", quot: '"' };
  const decode = (s: string) => s.replace(/&(amp|lt|gt|apos|quot);/g, (_, e: string) => entities[e]!);
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const date = parseStatementDate(field(block, "DTPOSTED"));
    const amountCents = parseStatementAmount(field(block, "TRNAMT"));
    if (!date || !amountCents) { skipped++; continue; }
    const name = decode(field(block, "NAME"));
    const memo = decode(field(block, "MEMO"));
    const label = memo && !normalizeLabel(name).includes(normalizeLabel(memo)) ? `${name} ${memo}` : name || memo;
    const fitId = field(block, "FITID");
    lines.push({ date, amountCents, label: cleanLabel(label), ...(fitId ? { fitId } : {}) });
  }
  return { format: "OFX", lines, skipped, warnings: lines.length === 0 && skipped === 0 ? ["Aucune opération trouvée dans ce fichier OFX."] : [] };
}

/** Lit un relevé CSV ou OFX (détecté sur le contenu, pas sur l'extension). */
export function parseStatement(text: string): ParsedStatement {
  const clean = text.replace(/^﻿/, "");
  const parsed = /OFXHEADER|<OFX>/i.test(clean.slice(0, 2000)) ? parseOfx(clean) : parseCsv(clean);
  if (parsed.skipped > 0) parsed.warnings.push(`${parsed.skipped} ligne(s) ignorée(s) : date ou montant illisible.`);
  return parsed;
}

/**
 * Clé d'idempotence de chaque ligne : identifiant bancaire (OFX) sinon date, montant, libellé normalisé et rang parmi les lignes
 * identiques du fichier (deux cafés identiques le même jour restent deux opérations). L'API en stocke l'empreinte.
 */
export function importKeys(lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    if (l.fitId) return `ofx:${l.fitId}`;
    const base = `${l.date}|${l.amountCents}|${normalizeLabel(l.label)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `csv:${base}|${n}`;
  });
}

/** Ressemblance de deux libellés (0 à 1) : mots communs de 3 lettres ou plus. */
export function labelSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(normalizeLabel(s).split(" ").filter((w) => w.length >= 3));
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return (2 * common) / (x.size + y.size);
}

export type ReconcileStatus = "NEW" | "ALREADY_IMPORTED" | "MATCHED" | "RECURRING";

export interface ExistingTransaction {
  id: string;
  date: string;
  amountCents: number;
  label: string;
  /** Empreinte d'import (null = opération saisie à la main). */
  importKey: string | null;
}

export interface ReconciledLine extends StatementLine {
  key: string;
  status: ReconcileStatus;
  /** Opération déjà saisie (MATCHED, ALREADY_IMPORTED) ou règle récurrente (RECURRING) correspondante. */
  match?: { id: string; date: string; label: string };
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Classe chaque ligne du relevé (d'un même compte) :
 *  - ALREADY_IMPORTED : même clé déjà importée, ou opération importée d'un autre fichier avec même date et même montant ;
 *  - MATCHED : opération saisie à la main, même montant, à `toleranceDays` jours près (la plus proche, puis le libellé le plus ressemblant) ;
 *  - RECURRING : occurrence d'une règle récurrente du compte (déjà comptée : l'importer la compterait deux fois) ;
 *  - NEW : à créer.
 * Une opération ou une occurrence ne sert qu'une fois.
 */
export function reconcile(
  lines: (StatementLine & { key: string })[],
  existing: ExistingTransaction[],
  rules: (RecurringRule & { label: string })[],
  toleranceDays = 2,
): ReconciledLine[] {
  const used = new Set<string>();
  const keys = new Set(existing.flatMap((t) => (t.importKey ? [t.importKey] : [])));
  return lines.map((line) => {
    if (keys.has(line.key)) return { ...line, status: "ALREADY_IMPORTED" as const };
    const sameImported = existing.find((t) => t.importKey && !used.has(t.id) && t.amountCents === line.amountCents && t.date === line.date);
    if (sameImported) {
      used.add(sameImported.id);
      return { ...line, status: "ALREADY_IMPORTED" as const, match: { id: sameImported.id, date: sameImported.date, label: sameImported.label } };
    }

    const manual = existing
      .filter((t) => !t.importKey && !used.has(t.id) && t.amountCents === line.amountCents && dayDiff(t.date, line.date) <= toleranceDays)
      .sort((a, b) => dayDiff(a.date, line.date) - dayDiff(b.date, line.date) || labelSimilarity(b.label, line.label) - labelSimilarity(a.label, line.label))[0];
    if (manual) {
      used.add(manual.id);
      return { ...line, status: "MATCHED" as const, match: { id: manual.id, date: manual.date, label: manual.label } };
    }

    for (const rule of rules) {
      if (rule.amountCents !== line.amountCents) continue;
      const occ = occurrences(rule, shift(line.date, -toleranceDays), shift(line.date, toleranceDays))
        .map((d) => d.toISOString().slice(0, 10))
        .find((d) => !used.has(`${rule.id}|${d}`));
      if (occ) {
        used.add(`${rule.id}|${occ}`);
        return { ...line, status: "RECURRING" as const, match: { id: rule.id, date: occ, label: rule.label } };
      }
    }
    return { ...line, status: "NEW" as const };
  });
}
