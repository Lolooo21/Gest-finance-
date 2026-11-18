import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractScanImages, looksLikeJpeg, looksLikePng, ocrImages } from "../src/payslip/ocr.js";
import { admin, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

// Fiche de paie SYNTHÉTIQUE (aucune donnée réelle), rendue en image : la reconnaissance de caractères est réelle, pas simulée.
const FIXTURES = join(import.meta.dirname, "fixtures");
const PNG = readFileSync(join(FIXTURES, "fiche-paie-synthetique.png"));
const JPEG = readFileSync(join(FIXTURES, "fiche-paie-synthetique.jpg"));
const EXPECTED = { netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-09", ocr: true };

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async () => ({ access: sessionCookies(await post(app, "/auth/register", owner(1))).access! });

function upload(c: { access: string }, file: Buffer, type: string, name: string) {
  const boundary = "----ocrboundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({ method: "POST", url: "/payslips/parse", payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, cookies: c });
}

/** PDF « scanné » : une page qui ne contient qu'une image JPEG, comme en produisent les scanners. */
async function scannedPdf(jpeg: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return Buffer.from(await doc.save());
}

describe("OCR des fiches de paie", () => {
  it("reconnaît les signatures de fichiers et retrouve la page JPEG d'un PDF scanné", async () => {
    expect(looksLikePng(PNG)).toBe(true);
    expect(looksLikeJpeg(JPEG)).toBe(true);
    expect(looksLikeJpeg(PNG)).toBe(false);
    const pages = await extractScanImages(await scannedPdf(JPEG));
    expect(pages).toHaveLength(1);
    expect(Buffer.from(pages[0]!).equals(JPEG)).toBe(true);
    expect(await extractScanImages(Buffer.from("%PDF-1.4 pas un vrai pdf"))).toEqual([]);
  });

  it("lit une photo PNG et propose les valeurs, avec un avertissement de vérification", async () => {
    const c = await register();
    const res = await upload(c, PNG, "image/png", "fiche.png");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject(EXPECTED);
    expect(body.employer).toMatch(/ACME Conseil/i);
    expect(body.warnings[0]).toContain("vérifiez chaque montant");
    // Rien n'est enregistré à la lecture ; le journal ne contient que l'action.
    expect(await admin.transaction.count()).toBe(0);
    expect((await admin.auditLog.findMany()).map((e) => e.action)).toContain("payslip.parsed:ocr");
  }, 60_000);

  it("lit un PDF scanné (sans texte) par OCR de sa page", async () => {
    const c = await register();
    const res = await upload(c, await scannedPdf(JPEG), "application/pdf", "scan.pdf");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(EXPECTED);
  }, 60_000);

  it("refuse un autre format, une image sans texte, et une lecture qui dépasse le délai", async () => {
    const c = await register();
    expect((await upload(c, Buffer.from("GIF89a......"), "image/gif", "x.gif")).statusCode).toBe(400);
    // Page blanche (600 × 400) : aucun texte reconnu.
    const blank = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAAAAABXXkFEAAACyElEQVR42u3SQQ0AAAjEMMC/58MECZ9WwrJOwb2RAGNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY2EsCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4Gx+LDk+wQfGrXqyAAAAABJRU5ErkJggg==", "base64");
    const empty = await upload(c, blank, "image/png", "vide.png");
    expect(empty.statusCode).toBe(422);
    expect(empty.json().message).toContain("Aucun texte reconnu");
    // Image d'un seul pixel : Tesseract échoue, l'erreur est convertie en message clair (et n'arrête pas le serveur).
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==", "base64");
    const tiny = await upload(c, pixel, "image/png", "pixel.png");
    expect(tiny.statusCode).toBe(422);
    expect(tiny.json().message).toContain("Image illisible");
    await expect(ocrImages([PNG], 1)).rejects.toThrow(/trop longue/);
  }, 60_000);

  it("une seule lecture à la fois : une deuxième demande simultanée est priée de réessayer", async () => {
    const first = ocrImages([PNG]);
    await expect(ocrImages([PNG])).rejects.toMatchObject({ status: 429 });
    expect(await first).toMatch(/Net paye/i);
    expect(await ocrImages([PNG])).toMatch(/Salaire brut/i); // le verrou est libéré
  }, 60_000);
});
