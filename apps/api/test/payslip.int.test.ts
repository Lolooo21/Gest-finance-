import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, owner, post, resetDb, sessionCookies, startApp, admin } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const account = async (c: { access: string }) => (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id as string;

async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 760 - 24 * i, font, size: 12 }));
  return Buffer.from(await doc.save());
}

const PAYSLIP = [
  "BULLETIN DE PAIE", "Employeur : ACME Conseil SAS", "Periode du 01/09/2026 au 30/09/2026",
  "Salaire brut 3 120,50", "Net a payer avant impot sur le revenu 2 430,40", "Prelevement a la source 145,00", "Net paye 2 285,40",
];

function upload(c: { access: string } | undefined, file: Buffer, type = "application/pdf", target: NestFastifyApplication = app) {
  const boundary = "----testboundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\nContent-Type: ${type}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return target.inject({ method: "POST", url: "/payslips/parse", payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, cookies: c });
}

const confirmBody = (accountId: string, extra: object = {}) => ({
  accountId, netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-09", employer: "ACME Conseil SAS", paymentDate: "2026-09-30", ...extra,
});

describe("lecture d'une fiche de paie", () => {
  it("propose les valeurs extraites sans rien enregistrer", async () => {
    const c = await register();
    const res = await upload(c, await makePdf(PAYSLIP));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-09", employer: "ACME Conseil SAS", confidence: 1, warnings: [] });
    const prisma = admin;
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.payslipImport.count()).toBe(0);
  });

  it("refuse un fichier qui n'est pas un PDF, un PDF corrompu, un scan sans texte et une requête non multipart", async () => {
    const c = await register();
    expect((await upload(c, Buffer.from("juste du texte"), "text/plain")).statusCode).toBe(400);
    expect((await upload(c, Buffer.from("%PDF-1.4 ceci est corrompu"))).statusCode).toBe(400);
    const blank = await PDFDocument.create();
    blank.addPage();
    const scan = await upload(c, Buffer.from(await blank.save()));
    expect(scan.statusCode).toBe(422);
    expect(scan.json().message).toContain("OCR");
    expect((await post(app, "/payslips/parse", { a: 1 }, c)).statusCode).toBe(400);
  });

  it("refuse un fichier de plus de 5 Mo", async () => {
    const c = await register();
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    expect((await upload(c, big)).statusCode).toBe(413);
  });

  it("exige une session et interdit l'import à un enfant", async () => {
    const a = await register();
    expect((await upload(undefined, await makePdf(PAYSLIP))).statusCode).toBe(401);
    await post(app, "/household/members", { email: "kid@example.com", password: "mot-de-passe-enfant-1", displayName: "Kid", role: "CHILD" }, a);
    const kid = { access: sessionCookies(await post(app, "/auth/login", { email: "kid@example.com", password: "mot-de-passe-enfant-1" })).access! };
    expect((await upload(kid, await makePdf(PAYSLIP))).statusCode).toBe(403);
    expect((await post(app, "/payslips/confirm", confirmBody("00000000-0000-4000-8000-000000000000"), kid)).statusCode).toBe(403);
  });

  it("limite le nombre d'imports par minute", async () => {
    // Application dédiée : le compteur de débit ne doit pas fausser les autres tests du fichier.
    const limited = await startApp();
    const c = { access: sessionCookies(await post(limited, "/auth/register", owner(9))).access! };
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await upload(c, Buffer.from("x"), "application/pdf", limited)).statusCode);
    expect(codes).toContain(429);
    await limited.close();
  });
});

describe("validation et enregistrement", () => {
  it("crée le revenu, met à jour le reste à vivre et ne journalise aucun montant", async () => {
    const c = await register();
    const accountId = await account(c);
    const res = await post(app, "/payslips/confirm", confirmBody(accountId), c);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ruleId: null, recurringStart: null });

    const txs = (await get(app, "/transactions", c)).json();
    expect(txs[0]).toMatchObject({ label: "Salaire 2026-09", amountCents: 228_540, date: "2026-09-30" });
    expect((await get(app, "/summary?from=2026-09-01&to=2026-09-30", c)).json().remainingCents).toBe(228_540);

    const audit = JSON.stringify((await get(app, "/household/audit", c)).json());
    expect(audit).toContain("payslip.confirmed");
    expect(audit).not.toContain("228540");
    expect(await admin.payslipImport.count()).toBe(1);
  });

  it("détecte un doublon (409), l'accepte avec force, et permet de réimporter après suppression de l'opération", async () => {
    const c = await register();
    const accountId = await account(c);
    expect((await post(app, "/payslips/confirm", confirmBody(accountId), c)).statusCode).toBe(201);
    expect((await post(app, "/payslips/confirm", confirmBody(accountId), c)).statusCode).toBe(409);
    expect((await post(app, "/payslips/confirm", confirmBody(accountId, { netToPayCents: 228_541 }), c)).statusCode).toBe(201);
    expect((await post(app, "/payslips/confirm", confirmBody(accountId, { force: true }), c)).statusCode).toBe(201);

    const prisma = admin;
    await prisma.transaction.deleteMany();
    expect((await post(app, "/payslips/confirm", confirmBody(accountId), c)).statusCode).toBe(201);
  });

  it("crée une récurrence mensuelle qui démarre le mois suivant, sans compter le salaire deux fois", async () => {
    const c = await register();
    const accountId = await account(c);
    const res = (await post(app, "/payslips/confirm", confirmBody(accountId, { createRecurring: true, paymentDate: "2026-09-30" }), c)).json();
    expect(res.recurringStart).toBe("2026-10-30");
    expect((await get(app, "/summary?from=2026-09-01&to=2026-09-30", c)).json().incomeCents).toBe(228_540);
    expect((await get(app, "/summary?from=2026-10-01&to=2026-10-31", c)).json().incomeCents).toBe(228_540);
    expect((await get(app, "/recurring-rules", c)).json()[0]).toMatchObject({ label: "Salaire ACME Conseil SAS", frequency: "MONTHLY", amountCents: 228_540 });
  });

  it("refuse un compte d'un autre foyer (IDOR) et des valeurs invalides", async () => {
    const a = await register(1);
    const b = await register(2);
    const accountOfB = await account(b);
    expect((await post(app, "/payslips/confirm", confirmBody(accountOfB), a)).statusCode).toBe(404);
    const own = await account(a);
    for (const bad of [{ netToPayCents: 0 }, { netToPayCents: -5 }, { periodMonth: "2026-13" }, { paymentDate: "demain" }, { accountId: "pas-un-uuid" }]) {
      expect((await post(app, "/payslips/confirm", confirmBody(own, bad), a)).statusCode).toBe(400);
    }
    expect(await admin.transaction.count()).toBe(0);
  });
});

describe("lecture de PDF aux mises en page difficiles", () => {
  /** Dessine chaque fragment à une position précise (x, y), comme un tableau écrit colonne par colonne. */
  async function tablePdf(cells: { text: string; x: number; y: number }[]): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage();
    for (const c of cells) page.drawText(c.text, { x: c.x, y: c.y, font, size: 11 });
    return Buffer.from(await doc.save());
  }

  it("retrouve le montant d'un libellé même quand les colonnes sont écrites séparément et dans le désordre", async () => {
    const c = await register();
    // Les montants sont écrits AVANT les libellés dans le flux du PDF, comme beaucoup de logiciels de paie.
    const pdf = await tablePdf([
      { text: "3 120,50", x: 400, y: 700 }, { text: "2 285,40", x: 400, y: 640 },
      { text: "Salaire brut", x: 40, y: 700 }, { text: "Net paye", x: 40, y: 640 },
      { text: "Periode du 01/03/2026 au 31/03/2026", x: 40, y: 760 },
      { text: "ACME CONSEIL SAS", x: 40, y: 790 },
    ]);
    const r = (await upload(c, pdf)).json();
    expect(r).toMatchObject({ netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-03", employer: "ACME CONSEIL SAS" });
    expect(r.confidence).toBe(1);
  });

  it("lit les montants écrits avec des espaces insécables (U+00A0)", async () => {
    const c = await register();
    const pdf = await tablePdf([
      { text: "Net paye : 2 285,40", x: 40, y: 700 },
      { text: "Salaire brut 3 120,50", x: 40, y: 670 },
      { text: "Mois de mars 2026", x: 40, y: 730 },
    ]);
    expect((await upload(c, pdf)).json()).toMatchObject({ netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-03" });
  });
});
