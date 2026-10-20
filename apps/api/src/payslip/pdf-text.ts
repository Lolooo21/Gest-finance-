import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGES = 5;
const MIN_TEXT = 20;

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
      text += content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
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
