import { describe, expect, it } from "vitest";
import { dueSlot, latestSlot } from "./index.js";

const paris = (weekday: number, hour: number) => ({ weekday, hour, timezone: "Europe/Paris" });
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("latestSlot", () => {
  it("renvoie le dimanche 18h local précédent (heure d'hiver, UTC+1)", () => {
    // mercredi 2026-01-14 12:00 UTC → dernier dimanche 2026-01-11 18:00 Paris = 17:00 UTC
    expect(iso(latestSlot(new Date("2026-01-14T12:00:00Z"), paris(7, 18)))).toBe("2026-01-11T17:00:00.000Z");
  });

  it("gère l'heure d'été (UTC+2)", () => {
    // mercredi 2026-07-15 → dimanche 2026-07-12 18:00 Paris = 16:00 UTC
    expect(iso(latestSlot(new Date("2026-07-15T12:00:00Z"), paris(7, 18)))).toBe("2026-07-12T16:00:00.000Z");
  });

  it("le jour même : avant l'heure → semaine précédente, après l'heure → aujourd'hui", () => {
    // dimanche 2026-01-11
    expect(iso(latestSlot(new Date("2026-01-11T16:59:00Z"), paris(7, 18)))).toBe("2026-01-04T17:00:00.000Z");
    expect(iso(latestSlot(new Date("2026-01-11T17:00:00Z"), paris(7, 18)))).toBe("2026-01-11T17:00:00.000Z");
  });

  it("traverse le passage à l'heure d'été (dimanche 2026-03-29)", () => {
    // créneau samedi 12h : samedi 28 mars est encore en UTC+1 → 11:00 UTC
    expect(iso(latestSlot(new Date("2026-03-29T10:00:00Z"), paris(6, 12)))).toBe("2026-03-28T11:00:00.000Z");
    // créneau dimanche 12h le jour du changement : UTC+2 → 10:00 UTC
    expect(iso(latestSlot(new Date("2026-03-29T10:00:00Z"), paris(7, 12)))).toBe("2026-03-29T10:00:00.000Z");
  });

  it("respecte un autre fuseau", () => {
    const ny = { weekday: 1, hour: 9, timezone: "America/New_York" };
    // lundi 2026-01-12 09:00 New York = 14:00 UTC
    expect(iso(latestSlot(new Date("2026-01-13T00:00:00Z"), ny))).toBe("2026-01-12T14:00:00.000Z");
  });
});

describe("dueSlot", () => {
  const cfg = paris(7, 18);
  const now = new Date("2026-01-14T12:00:00Z");

  it("n'est pas dû si le rappel a été activé après le dernier créneau", () => {
    expect(dueSlot(now, cfg, new Date("2026-01-13T08:00:00Z"), null)).toBeNull();
  });

  it("est dû si activé avant le créneau et bilan jamais fait", () => {
    expect(iso(dueSlot(now, cfg, new Date("2026-01-05T08:00:00Z"), null))).toBe("2026-01-11T17:00:00.000Z");
  });

  it("n'est plus dû une fois le bilan fait après le créneau, mais l'est si fait avant", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    expect(dueSlot(now, cfg, since, new Date("2026-01-12T09:00:00Z"))).toBeNull();
    expect(dueSlot(now, cfg, since, new Date("2026-01-09T09:00:00Z"))).not.toBeNull();
  });
});
