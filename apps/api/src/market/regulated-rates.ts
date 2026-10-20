/**
 * Taux réglementés : données éditoriales versionnées (ils ne changent que le 1er février et le 1er août).
 * À mettre à jour à chaque arrêté ; l'API signale automatiquement une période échue (« périmé »).
 * Points de base : 170 = 1,70 %.
 */
export interface RegulatedRates {
  validFrom: string;
  validTo: string;
  livretABp: number;
  lddsBp: number;
  lepBp: number;
  sourceUrl: string;
  note?: string;
}

export const REGULATED_RATES: RegulatedRates[] = [
  {
    validFrom: "2026-08-01",
    validTo: "2027-01-31",
    livretABp: 170,
    lddsBp: 170,
    lepBp: 250,
    sourceUrl: "https://www.info.gouv.fr/actualite/augmentation-du-taux-du-livret-a-a-compter-du-1er-aout-2026",
    note: "Arrêté du 28 juillet 2026. Le LEP est maintenu à 2,5 % alors que la formule de calcul aurait donné 2,2 %.",
  },
  {
    validFrom: "2026-02-01",
    validTo: "2026-07-31",
    livretABp: 150,
    lddsBp: 150,
    lepBp: 250,
    sourceUrl: "https://www.info.gouv.fr/actualite/augmentation-du-taux-du-livret-a-a-compter-du-1er-aout-2026",
    note: "Taux en vigueur avant le 1er août 2026.",
  },
];

/** Le taux du PEL est fixé à l'ouverture du plan et ne change plus : il dépend de l'année d'ouverture. */
export const PEL_RATES = [
  {
    openedIn: 2026,
    rateBp: 200,
    sourceUrl: "https://www.moneyvox.fr/placement/actualites/106775/c-est-officiel-le-taux-des-pel-ouverts-en-2026-remonte-a-2",
  },
];

export interface CurrentRates {
  current: RegulatedRates;
  previous: RegulatedRates | null;
  /** Vrai si la période de validité de la dernière version est échue : les taux ont peut-être changé. */
  stale: boolean;
}

export function currentRegulatedRates(now: Date, versions: RegulatedRates[] = REGULATED_RATES): CurrentRates {
  const day = now.toISOString().slice(0, 10);
  const sorted = [...versions].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const index = sorted.findIndex((v) => v.validFrom <= day);
  const current = sorted[index === -1 ? sorted.length - 1 : index]!;
  const previous = sorted[(index === -1 ? sorted.length - 1 : index) + 1] ?? null;
  return { current, previous, stale: day > current.validTo || index === -1 };
}

export function currentPelRate(now: Date) {
  const year = now.getUTCFullYear();
  return [...PEL_RATES].sort((a, b) => b.openedIn - a.openedIn).find((p) => p.openedIn <= year) ?? null;
}
