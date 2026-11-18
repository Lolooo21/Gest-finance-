import { HttpException, HttpStatus, UnprocessableEntityException } from "@nestjs/common";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createWorker, OEM } from "tesseract.js";

/**
 * Lecture des fiches de paie scannées ou photographiées (OCR), 100 % locale : Tesseract compilé en WebAssembly, dans un thread
 * séparé, avec les données de langue française embarquées (aucun téléchargement, aucun envoi à un tiers).
 * Une seule lecture à la fois (mémoire du serveur), au plus 60 secondes ; ni l'image ni le texte ne sont conservés ou journalisés.
 */

const OCR_TIMEOUT_MS = 60_000;
/** Pages (images) lues au plus dans un PDF scanné. */
const MAX_SCAN_IMAGES = 3;
/** En dessous, une image de PDF est un logo ou une signature, pas une page scannée. */
const MIN_SCAN_IMAGE_BYTES = 20_000;

export const looksLikeJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const looksLikePng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** Données « best_int » (précises et compactes) du paquet @tesseract.js-data/fra, lues sur le disque. */
const LANG_PATH = join(dirname(createRequire(import.meta.url).resolve("@tesseract.js-data/fra/package.json")), "4.0.0_best_int");

/**
 * Pages d'un PDF scanné : les images JPEG (filtre DCTDecode) qu'il contient, telles quelles, dans l'ordre du fichier. C'est le
 * format de la plupart des scanners et applications de numérisation. Les autres formats d'image (fax, JBIG2…) ne sont pas lus.
 */
export async function extractScanImages(pdf: Uint8Array): Promise<Uint8Array[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return [];
  }
  const images: Uint8Array[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const filter = obj.dict.get(PDFName.of("Filter"));
    const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
    if (filters.length !== 1 || filters[0] !== PDFName.of("DCTDecode")) continue;
    if (obj.contents.length >= MIN_SCAN_IMAGE_BYTES && looksLikeJpeg(obj.contents)) images.push(obj.contents);
    if (images.length >= MAX_SCAN_IMAGES) break;
  }
  return images;
}

let busy = false;

/** Texte reconnu dans les images (JPEG ou PNG), page après page. */
export async function ocrImages(images: Uint8Array[], timeoutMs = OCR_TIMEOUT_MS): Promise<string> {
  if (busy) throw new HttpException("Une autre fiche de paie est en cours de lecture : réessayez dans un instant.", HttpStatus.TOO_MANY_REQUESTS);
  busy = true;
  let timer: NodeJS.Timeout | undefined;
  // errorHandler : une erreur interne de Tesseract (image dégénérée) rejette la lecture en cours au lieu de remonter
  // comme erreur non gérée du thread.
  const worker = await createWorker("fra", OEM.LSTM_ONLY, { langPath: LANG_PATH, gzip: true, cacheMethod: "none", errorHandler: () => undefined }).catch(() => {
    busy = false;
    throw new UnprocessableEntityException("La lecture des scans est indisponible sur ce serveur.");
  });
  try {
    const read = (async () => {
      let text = "";
      for (const image of images) text += (await worker.recognize(Buffer.from(image))).data.text + "\n";
      return text;
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new UnprocessableEntityException("Lecture trop longue : envoyez une photo plus nette ou un PDF numérique.")), timeoutMs);
    });
    return await Promise.race([read, timeout]);
  } catch (e) {
    if (e instanceof HttpException) throw e;
    throw new UnprocessableEntityException("Image illisible : envoyez une photo nette, bien éclairée, prise bien droite.");
  } finally {
    clearTimeout(timer);
    busy = false;
    await worker.terminate().catch(() => undefined);
  }
}
