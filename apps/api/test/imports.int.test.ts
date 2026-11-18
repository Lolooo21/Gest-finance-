import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { admin, get, owner, post, resetDb, sessionCookies, startApp, fieldCipher } from "./helpers.js";

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => resetDb(app));

type Cookies = { access: string };
const register = async (n = 1) => ({ access: sessionCookies(await post(app, "/auth/register", owner(n))).access! });
const newAccount = async (c: Cookies) => (await post(app, "/accounts", { name: "Courant", type: "CHECKING", initialBalanceCents: 0 }, c)).json().id as string;

function upload(c: Cookies | undefined, accountId: string, file: Buffer | string) {
  const boundary = "----testboundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="releve.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    typeof file === "string" ? Buffer.from(file) : file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({ method: "POST", url: `/imports/preview?accountId=${accountId}`, payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, cookies: c });
}

type Line = { key: string; date: string; amountCents: number; label: string; status: string; match?: { id: string } };
/** Lignes de l'aperçu à envoyer à la validation : nouvelles à créer, saisies manuelles à rapprocher. */
const selection = (lines: Line[]) =>
  lines.flatMap((l) =>
    l.status === "NEW" ? [{ key: l.key, date: l.date, amountCents: l.amountCents, label: l.label, action: "CREATE" }]
    : l.status === "MATCHED" ? [{ key: l.key, date: l.date, amountCents: l.amountCents, label: l.label, action: "LINK", transactionId: l.match!.id }]
    : [],
  );

const CSV = [
  "Date;Libellé;Montant",
  "03/11/2026;CB CARREFOUR;-45,30",
  "05/11/2026;PRLV LOYER;-800,00",
  "06/11/2026;CB BOULANGERIE;-3,20",
  "06/11/2026;CB BOULANGERIE;-3,20",
  "10/11/2026;VIR SALAIRE;2 500,00",
].join("\n");

describe("import de relevés", () => {
  it("exige une session, un compte du foyer, un adulte et un fichier lisible", async () => {
    const c = await register();
    const acc = await newAccount(c);
    expect((await upload(undefined, acc, CSV)).statusCode).toBe(401);
    expect((await upload(c, "pas-un-uuid", CSV)).statusCode).toBe(400);
    const other = await newAccount(await register(2));
    expect((await upload(c, other, CSV)).statusCode).toBe(404);
    const pdf = await upload(c, acc, "%PDF-1.7 relevé");
    expect(pdf.statusCode).toBe(415);
    expect(pdf.json().message).toMatch(/exportez vos opérations en CSV ou en OFX/);
    expect((await upload(c, acc, Buffer.alloc(2 * 1024 * 1024 + 10, 65))).statusCode).toBe(413);
    const noHeader = (await upload(c, acc, "a;b\n1;2")).json();
    expect(noHeader).toMatchObject({ lines: [], summary: { NEW: 0 } });
    expect(noHeader.warnings[0]).toMatch(/En-tête introuvable/);

    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, c);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    expect((await upload(child, acc, CSV)).statusCode).toBe(403);
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [] }, child)).statusCode).toBe(403);
  });

  it("propose un aperçu rapproché (saisie manuelle, récurrence), importe puis ne réimporte jamais deux fois", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const manual = (await post(app, "/transactions", { accountId: acc, amountCents: -4_530, date: "2026-11-02", label: "Courses" }, c)).json();
    await post(app, "/recurring-rules", { accountId: acc, label: "Loyer", amountCents: -80_000, frequency: "MONTHLY", start: "2026-01-05" }, c);

    const preview = await upload(c, acc, CSV);
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body).toMatchObject({ format: "CSV", summary: { NEW: 3, MATCHED: 1, RECURRING: 1, ALREADY_IMPORTED: 0 } });
    expect(body.lines.map((l: Line) => l.status)).toEqual(["MATCHED", "RECURRING", "NEW", "NEW", "NEW"]);
    expect(body.lines[0].match).toMatchObject({ id: manual.id, label: "Courses" });
    expect(body.lines[0].key).toMatch(/^[a-f0-9]{64}$/);
    // Aperçu seulement : rien n'est encore enregistré.
    expect(await admin.transaction.count()).toBe(1);

    const confirm = await post(app, "/imports/confirm", { accountId: acc, lines: selection(body.lines) }, c);
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json()).toEqual({ created: 3, linked: 1, skipped: 0 });
    const rows = await admin.transaction.findMany({ orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
    expect(rows.map((r) => [fieldCipher.decryptField(r.label), r.amountCents])).toEqual([["Courses", -4_530], ["CB BOULANGERIE", -320], ["CB BOULANGERIE", -320], ["VIR SALAIRE", 250_000]]);
    expect(rows.every((r) => r.importHash)).toBe(true);
    // Le libellé saisi à la main est conservé ; seul le rapprochement est mémorisé.
    expect(rows[0]!.id).toBe(manual.id);

    const again = (await upload(c, acc, CSV)).json();
    expect(again.summary).toEqual({ NEW: 0, MATCHED: 0, RECURRING: 1, ALREADY_IMPORTED: 4 });
    // Un renvoi de la même validation (double clic) ne crée rien.
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: selection(body.lines) }, c)).json()).toEqual({ created: 0, linked: 0, skipped: 4 });
    expect(await admin.transaction.count()).toBe(4);

    const log = (await admin.auditLog.findMany()).map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(["statement.previewed", "statement.imported:3+1"]));
    expect(JSON.stringify(log)).not.toMatch(/CARREFOUR|4530/);
  });

  it("lit un OFX et un CSV en Windows-1252, et reconnaît un même relevé importé d'un autre format", async () => {
    const c = await register();
    const acc = await newAccount(c);
    const latin1 = Buffer.from("Date;Libellé;Montant\n03/11/2026;Café Égalité;-2,50\n", "latin1");
    const csv = (await upload(c, acc, latin1)).json();
    expect(csv.lines[0]).toMatchObject({ label: "Café Égalité", amountCents: -250, status: "NEW" });
    await post(app, "/imports/confirm", { accountId: acc, lines: selection(csv.lines) }, c);

    const ofx = "OFXHEADER:100\n<OFX><STMTTRN><DTPOSTED>20261103<TRNAMT>-2.50<FITID>Z1<NAME>CAFE EGALITE</STMTTRN></OFX>";
    const parsed = (await upload(c, acc, ofx)).json();
    expect(parsed).toMatchObject({ format: "OFX", summary: { ALREADY_IMPORTED: 1, NEW: 0 } });
  });

  it("refuse un rapprochement vers une opération d'un autre compte ou foyer, et valide les lignes", async () => {
    const a = await register();
    const acc = await newAccount(a);
    const b = await register(2);
    const accB = await newAccount(b);
    const foreign = (await post(app, "/transactions", { accountId: accB, amountCents: -100, date: "2026-11-01", label: "x" }, b)).json();
    const key = "a".repeat(64);
    const link = { key, date: "2026-11-01", amountCents: -100, label: "x", action: "LINK", transactionId: foreign.id };
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [link] }, a)).statusCode).toBe(400);
    expect((await post(app, "/imports/confirm", { accountId: accB, lines: [link] }, a)).statusCode).toBe(404);
    expect((await admin.transaction.findUniqueOrThrow({ where: { id: foreign.id } })).importHash).toBeNull();

    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [{ ...link, transactionId: undefined }] }, a)).statusCode).toBe(400);
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [{ ...link, action: "CREATE", key: "pas-une-empreinte" }] }, a)).statusCode).toBe(400);
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [] }, a)).statusCode).toBe(400);
    // Une opération importée compte dans le solde du compte.
    expect((await post(app, "/imports/confirm", { accountId: acc, lines: [{ ...link, action: "CREATE", transactionId: undefined }] }, a)).json()).toMatchObject({ created: 1 });
    expect((await get(app, "/accounts", a)).json()[0].balanceCents).toBe(-100);
  });
});
