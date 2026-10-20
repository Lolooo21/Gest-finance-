import { describe, expect, it } from "vitest";
import { parseSdmxCsv } from "../src/market/sdmx-csv.js";
import { currentPelRate, currentRegulatedRates, REGULATED_RATES } from "../src/market/regulated-rates.js";
import { SAVINGS_PRODUCTS } from "../src/market/savings-products.js";

const ECB_CSV = `KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK,OBS_COM,TIME_FORMAT,COLLECTION,COMPILING_ORG,DISS_ORG,DOM_SER_IDS,GOV_ENT_BNK_SECTOR,MATURITY,TITLE,TITLE_COMPL,UNIT,UNIT_MULT
FM.B.U2.EUR.4F.KR.DFR.LEV,B,U2,EUR,4F,KR,DFR,LEV,2025-06-11,2.00,A,F,,,P1D,A,,,,,,"ECB deposit facility rate, Level","European Central Bank (ECB), Deposit facility - date of changes (raw data), Level",PC,0
`;

const EUROSTAT_CSV = `﻿"DATAFLOW","LAST UPDATE","freq","unit","coicop","geo","TIME_PERIOD","OBS_VALUE","OBS_FLAG","CONF_STATUS"
"ESTAT:PRC_HICP_MANR(1.0)","16/10/26 11:00:00","M","RCH_A","CP00","FR","2026-08",1.4,,
"ESTAT:PRC_HICP_MANR(1.0)","16/10/26 11:00:00","M","RCH_A","CP00","FR","2026-09",1.2,,
`;

describe("parseSdmxCsv", () => {
  it("lit une réponse de la BCE (colonnes entre guillemets avec virgules incluses)", () => {
    expect(parseSdmxCsv(ECB_CSV)).toEqual({ period: "2025-06-11", value: 2 });
  });

  it("lit une réponse d'Eurostat (BOM, guillemets) et garde la période la plus récente", () => {
    expect(parseSdmxCsv(EUROSTAT_CSV)).toEqual({ period: "2026-09", value: 1.2 });
  });

  it("accepte les valeurs négatives et ignore les lignes sans valeur", () => {
    expect(parseSdmxCsv("TIME_PERIOD,OBS_VALUE\n2026-01,\n2026-02,-0.35\n2026-03,abc")).toEqual({ period: "2026-02", value: -0.35 });
  });

  it("refuse un format inattendu (page HTML, colonnes absentes, aucune observation)", () => {
    expect(() => parseSdmxCsv("<html><body>Erreur</body></html>")).toThrow(/Format inattendu/);
    expect(() => parseSdmxCsv("")).toThrow(/Format inattendu/);
    expect(() => parseSdmxCsv("TIME_PERIOD,OBS_VALUE\n2026-01,\n")).toThrow(/Aucune observation/);
  });
});

describe("taux réglementés", () => {
  it("renvoie la période en vigueur, la précédente, et non périmé", () => {
    const r = currentRegulatedRates(new Date("2026-10-20T10:00:00Z"));
    expect(r.current).toMatchObject({ validFrom: "2026-08-01", livretABp: 170, lddsBp: 170, lepBp: 250 });
    expect(r.previous).toMatchObject({ validFrom: "2026-02-01", livretABp: 150 });
    expect(r.stale).toBe(false);
  });

  it("signale les taux comme périmés quand la période de validité est échue", () => {
    expect(currentRegulatedRates(new Date("2027-02-02T00:00:00Z")).stale).toBe(true);
    expect(currentRegulatedRates(new Date("2027-01-31T23:00:00Z")).stale).toBe(false);
  });

  it("choisit la bonne version à une date passée et repli sur la plus ancienne avant toute donnée", () => {
    expect(currentRegulatedRates(new Date("2026-03-01T00:00:00Z")).current.validFrom).toBe("2026-02-01");
    const old = currentRegulatedRates(new Date("2020-01-01T00:00:00Z"));
    expect(old.current.validFrom).toBe("2026-02-01");
    expect(old.stale).toBe(true);
  });

  it("garde des périodes cohérentes (sans trou ni chevauchement) et des taux plausibles", () => {
    const sorted = [...REGULATED_RATES].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    sorted.slice(1).forEach((v, i) => {
      const next = new Date(`${sorted[i]!.validTo}T00:00:00Z`).getTime() + 86_400_000;
      expect(new Date(next).toISOString().slice(0, 10)).toBe(v.validFrom);
    });
    for (const v of REGULATED_RATES) {
      for (const bp of [v.livretABp, v.lddsBp, v.lepBp]) {
        expect(bp).toBeGreaterThan(0);
        expect(bp).toBeLessThan(1000);
      }
    }
  });

  it("donne le taux du PEL de l'année d'ouverture", () => {
    expect(currentPelRate(new Date("2026-10-20T00:00:00Z"))).toMatchObject({ openedIn: 2026, rateBp: 200 });
    expect(currentPelRate(new Date("2030-01-01T00:00:00Z"))?.openedIn).toBe(2026);
    expect(currentPelRate(new Date("2000-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("fiches des supports d'épargne", () => {
  it("sont complètes, sans doublon, et les produits risqués avertissent d'une perte possible", () => {
    const ids = SAVINGS_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SAVINGS_PRODUCTS) {
      expect(p.summary.length).toBeGreaterThan(20);
      expect(p.watchOut.length).toBeGreaterThan(0);
      expect([null, "livretA", "ldds", "lep", "pel"]).toContain(p.rateRef);
      if (p.risk >= 4) expect(p.watchOut.join(" ").toLowerCase()).toMatch(/perte|garanti/);
    }
    expect(SAVINGS_PRODUCTS.filter((p) => p.rateRef).map((p) => p.rateRef)).toEqual(["livretA", "ldds", "lep", "pel"]);
  });
});
