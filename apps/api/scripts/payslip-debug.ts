/**
 * Diagnostic LOCAL de la lecture d'une fiche de paie : rien n'est envoyé, rien n'est enregistré.
 *
 *   pnpm payslip:debug chemin/vers/fiche.pdf            → ce qui est détecté + fiabilité
 *   pnpm payslip:debug chemin/vers/fiche.pdf --text     → + le texte lu par l'application
 *   pnpm payslip:debug chemin/vers/fiche.pdf --anonymize → + le texte avec tous les chiffres remplacés par 9
 *
 * Avec --anonymize, la structure de la fiche reste visible (libellés, mise en page) sans montants :
 * relisez-le (noms, adresses) avant de le partager pour améliorer la lecture.
 */
import { readFile } from "node:fs/promises";
import { parsePayslip } from "@gest-finance/finance-core";
import { extractPdfText } from "../src/payslip/pdf-text.js";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("Usage : pnpm payslip:debug <fichier.pdf> [--text] [--anonymize]");
  process.exit(1);
}

const euros = (c: number | null) => (c === null ? "non détecté" : `${(c / 100).toFixed(2).replace(".", ",")} €`);
const text = await extractPdfText(new Uint8Array(await readFile(file)));
const r = parsePayslip(text);

console.log(`Fiabilité        : ${Math.round(r.confidence * 100)} %`);
console.log(`Net à payer      : ${euros(r.netToPayCents)}`);
console.log(`Brut             : ${euros(r.grossCents)}`);
console.log(`Période          : ${r.periodMonth ?? "non détectée"}`);
console.log(`Employeur        : ${r.employer ?? "non détecté"}`);
for (const w of r.warnings) console.log(`⚠ ${w}`);
console.log(`Texte lu         : ${text.split("\n").filter(Boolean).length} lignes, ${text.length} caractères`);

if (flags.includes("--text")) console.log(`\n----- TEXTE LU -----\n${text}`);
if (flags.includes("--anonymize")) {
  const masked = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "(e-mail)").replace(/\d/g, "9");
  console.log(`\n----- TEXTE ANONYMISÉ (chiffres → 9) : relisez avant de partager -----\n${masked}`);
}
