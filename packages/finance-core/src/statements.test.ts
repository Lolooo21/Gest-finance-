import { describe, expect, it } from "vitest";
import {
  importKeys, labelSimilarity, normalizeLabel, parseStatement, parseStatementAmount, parseStatementDate, reconcile,
  type ExistingTransaction, type StatementLine,
} from "./index.js";

describe("lecture des montants et des dates", () => {
  it("lit les formats de montant des banques françaises", () => {
    expect(parseStatementAmount("-1 234,56")).toBe(-123_456);
    expect(parseStatementAmount("1 234,5 €")).toBe(123_450);
    expect(parseStatementAmount("+12.50")).toBe(1_250);
    expect(parseStatementAmount("−3,00")).toBe(-300);
    expect(parseStatementAmount("1,234.56")).toBe(123_456);
    expect(parseStatementAmount("42 EUR")).toBe(4_200);
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("abc")).toBeNull();
    expect(parseStatementAmount("1,234")).toBeNull();
    expect(parseStatementAmount("9".repeat(20))).toBeNull();
  });

  it("lit les formats de date et refuse une date impossible", () => {
    expect(parseStatementDate("03/11/2026")).toBe("2026-11-03");
    expect(parseStatementDate("3/1/26")).toBe("2026-01-03");
    expect(parseStatementDate("03.11.2026")).toBe("2026-11-03");
    expect(parseStatementDate("2026-11-03")).toBe("2026-11-03");
    expect(parseStatementDate("20261103120000[+1:CET]")).toBe("2026-11-03");
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("demain")).toBeNull();
  });

  it("normalise et compare les libellés", () => {
    expect(normalizeLabel("  CB Carrefour  Évry 12/11 ")).toBe("cb carrefour evry 12 11");
    expect(labelSimilarity("PRLV SEPA EDF", "Facture EDF prlv")).toBeCloseTo(2 / 3);
    expect(labelSimilarity("Courses", "")).toBe(0);
  });
});

describe("relevés CSV", () => {
  it("lit un export point-virgule avec lignes d'en-tête de banque, BOM, guillemets et lignes illisibles", () => {
    const csv = [
      "﻿Compte courant n° 12345;;;",
      "Solde au 15/11/2026;1 200,00;;",
      "",
      "Date opération;Date valeur;Libellé;Montant",
      '03/11/2026;04/11/2026;"CB CARREFOUR; EVRY";-45,30',
      "05/11/2026;05/11/2026;VIR SALAIRE ACME;2 500,00",
      "pas une date;;Ligne parasite;12,00",
      "06/11/2026;06/11/2026;Montant vide;",
    ].join("\r\n");
    const parsed = parseStatement(csv);
    expect(parsed.format).toBe("CSV");
    expect(parsed.lines).toEqual([
      { date: "2026-11-03", amountCents: -4_530, label: "CB CARREFOUR; EVRY" },
      { date: "2026-11-05", amountCents: 250_000, label: "VIR SALAIRE ACME" },
    ]);
    expect(parsed.skipped).toBe(2);
    expect(parsed.warnings).toEqual(["2 ligne(s) ignorée(s) : date ou montant illisible."]);
  });

  it("gère les colonnes Débit / Crédit séparées et la virgule comme séparateur", () => {
    const csv = 'Date,Description,Debit,Credit\n2026-11-02,"Loyer ""novembre""",800.00,\n2026-11-03,Remboursement,,"15.20"\n2026-11-04,Sans montant,,\n';
    expect(parseStatement(csv).lines).toEqual([
      { date: "2026-11-02", amountCents: -80_000, label: 'Loyer "novembre"' },
      { date: "2026-11-03", amountCents: 1_520, label: "Remboursement" },
    ]);
  });

  it("explique un fichier sans en-tête reconnu et donne un libellé par défaut", () => {
    expect(parseStatement("a;b;c\n1;2;3").warnings[0]).toMatch(/En-tête introuvable/);
    expect(parseStatement("Date;Libellé;Montant\n01/11/2026;;-5,00").lines[0]!.label).toBe("Opération");
  });
});

describe("relevés OFX", () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103<TRNAMT>-45.30<FITID>A1<NAME>CB CARREFOUR<MEMO>EVRY &amp; CIE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105120000<TRNAMT>2500,00<FITID>A2<NAME>VIR SALAIRE<MEMO>VIR SALAIRE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2026<TRNAMT>-1<NAME>Illisible</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("lit les opérations, l'identifiant bancaire et fusionne nom et mémo sans répétition", () => {
    const parsed = parseStatement(ofx);
    expect(parsed.format).toBe("OFX");
    expect(parsed.lines).toEqual([
      { date: "2026-11-03", amountCents: -4_530, label: "CB CARREFOUR EVRY & CIE", fitId: "A1" },
      { date: "2026-11-05", amountCents: 250_000, label: "VIR SALAIRE", fitId: "A2" },
    ]);
    expect(parsed.skipped).toBe(1);
  });

  it("signale un OFX sans opération", () => {
    expect(parseStatement("<OFX></OFX>").warnings).toEqual(["Aucune opération trouvée dans ce fichier OFX."]);
    expect(parseStatement("<OFX><STMTTRN><DTPOSTED>20261101<TRNAMT>-3<MEMO>Seul mémo</STMTTRN></OFX>").lines[0]).toEqual({ date: "2026-11-01", amountCents: -300, label: "Seul mémo" });
  });
});

describe("clés d'import et rapprochement", () => {
  const line = (date: string, amountCents: number, label: string, fitId?: string): StatementLine => ({ date, amountCents, label, ...(fitId ? { fitId } : {}) });

  it("donne une clé stable, distingue les lignes identiques et privilégie l'identifiant bancaire", () => {
    const keys = importKeys([line("2026-11-03", -250, "Café"), line("2026-11-03", -250, "CAFÉ"), line("2026-11-03", -250, "Pain", "X9")]);
    expect(keys).toEqual(["csv:2026-11-03|-250|cafe|1", "csv:2026-11-03|-250|cafe|2", "ofx:X9"]);
  });

  it("classe : déjà importée, rapprochée d'une saisie manuelle, récurrence, nouvelle", () => {
    const existing: ExistingTransaction[] = [
      { id: "t-import", date: "2026-11-01", amountCents: -1_000, label: "ANCIEN IMPORT", importKey: "k-old" },
      { id: "t-autre-fichier", date: "2026-11-02", amountCents: -999, label: "Même opération", importKey: "k-ofx" },
      { id: "t-loin", date: "2026-11-01", amountCents: -4_530, label: "Courses Carrefour", importKey: null },
      { id: "t-proche", date: "2026-11-04", amountCents: -4_530, label: "Divers", importKey: null },
      { id: "t-libelle", date: "2026-11-04", amountCents: -4_530, label: "Courses Carrefour", importKey: null },
    ];
    const rules = [{ id: "loyer", label: "Loyer", amountCents: -80_000, frequency: "MONTHLY" as const, start: "2026-01-05" }];
    const out = reconcile(
      [
        { ...line("2026-11-01", -1_000, "x"), key: "k-old" },
        { ...line("2026-11-02", -999, "Même opération"), key: "k-csv" },
        { ...line("2026-11-03", -4_530, "CB CARREFOUR"), key: "a" },
        { ...line("2026-11-03", -4_530, "CB CARREFOUR"), key: "b" },
        { ...line("2026-11-03", -4_530, "CB CARREFOUR"), key: "c" },
        { ...line("2026-11-03", -4_530, "CB CARREFOUR"), key: "d" },
        { ...line("2026-11-06", -80_000, "PRLV LOYER"), key: "e" },
        { ...line("2026-11-07", -80_000, "PRLV LOYER bis"), key: "f" },
      ],
      existing, rules,
    );
    expect(out.map((l) => [l.status, l.match?.id])).toEqual([
      ["ALREADY_IMPORTED", undefined],
      ["ALREADY_IMPORTED", "t-autre-fichier"],
      // À un jour d'écart, la saisie au libellé ressemblant passe avant l'autre ; puis la plus éloignée.
      ["MATCHED", "t-libelle"],
      ["MATCHED", "t-proche"],
      ["MATCHED", "t-loin"],
      ["NEW", undefined],
      ["RECURRING", "loyer"],
      // L'occurrence du 5 novembre ne sert qu'une fois.
      ["NEW", undefined],
    ]);
    expect(out[6]!.match).toEqual({ id: "loyer", date: "2026-11-05", label: "Loyer" });
  });

  it("respecte la tolérance de dates", () => {
    const existing: ExistingTransaction[] = [{ id: "t", date: "2026-11-01", amountCents: -100, label: "x", importKey: null }];
    expect(reconcile([{ ...line("2026-11-04", -100, "x"), key: "k" }], existing, [])[0]!.status).toBe("NEW");
    expect(reconcile([{ ...line("2026-11-04", -100, "x"), key: "k" }], existing, [], 3)[0]!.status).toBe("MATCHED");
  });
});
