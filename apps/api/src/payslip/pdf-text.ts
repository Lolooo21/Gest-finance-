import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

const MAX_PAGES = 5;
const MIN_TEXT = 20;

/**
 * Reconstruit les lignes de la page à partir de la position (x, y) de chaque fragment de texte.
 * Les tableaux de fiches de paie sont souvent écrits colonne par colonne : sans cela, « Net à payer » et son montant
 * ne se retrouvent pas côte à côte et la lecture échoue.
 */
export function rebuildLines(items: Pick<TextItem, "str" | "transform" | "width">[]): string {
  const pieces = items.filter((it) => it.str.trim() !== "").map((it) => ({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width }));
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; parts: typeof pieces }[] = [];
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l.y - p.y) <= 2.5);
    if (line) line.parts.push(p);
    else lines.push({ y: p.y, parts: [p] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      l.parts.sort((a, b) => a.x - b.x);
      return l.parts.reduce((acc, p, i) => {
        const prev = l.parts[i - 1];
        const gap = prev ? p.x - (prev.x + prev.w) : 0;
        return acc + (i === 0 ? "" : gap > 1 || /\s$/.test(acc) || /^\s/.test(p.str) ? " " : "") + p.str;
      }, "");
    })
    .join("\n");
}

export const looksLikePdf = (buf: Uint8Array) => buf.length > 5 && String.fromCharCode(...buf.subarray(0, 5)) === "%PDF-";

/**
 * Extrait le texte d'un PDF numérique, en mémoire. Aucun script ni police système n'est exécuté ou chargé,
 * seules les premières pages sont lues, et le texte extrait n'est jamais journalisé.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  if (!looksLikePdf(data)) throw new BadRequestException("Le fichier n'est pas un PDF");
  let text = "";
  try {
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
    }).promise;
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      text += rebuildLines(content.items.filter((it): it is TextItem => "str" in it)) + "\n";
    }
    await pdf.destroy();
  } catch {
    throw new BadRequestException("PDF illisible ou corrompu");
  }
  if (text.replace(/\s/g, "").length < MIN_TEXT) {
    throw new UnprocessableEntityException("Aucun texte exploitable : ce PDF est probablement un scan. La lecture des scans (OCR) n'est pas encore disponible.");
  }
  return text;
}
