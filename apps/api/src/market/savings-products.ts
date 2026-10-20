/**
 * Fiches pédagogiques des supports d'épargne. Contenu général et prudent : ni promesse de rendement,
 * ni conseil en investissement. Les taux officiels viennent de `regulated-rates.ts` (champ `rateRef`).
 */
export type Category = "Épargne réglementée" | "Placements financiers" | "Immobilier";

export interface SavingsProduct {
  id: string;
  name: string;
  category: Category;
  /** 1 = capital garanti … 5 = perte en capital possible et importante. */
  risk: 1 | 2 | 3 | 4 | 5;
  liquidity: string;
  ceiling: string | null;
  tax: string;
  horizon: string;
  summary: string;
  suitableFor: string;
  watchOut: string[];
  /** Taux officiel à afficher (dans `GET /market`), s'il existe. */
  rateRef: "livretA" | "ldds" | "lep" | "pel" | null;
}

export const SAVINGS_DISCLAIMER =
  "Informations générales à vocation pédagogique, non constitutives d'un conseil en investissement. Les performances passées ne préjugent pas des performances futures. Vérifiez les conditions et la fiscalité en vigueur auprès de sources officielles (service-public.fr, banque-france.fr, amf-france.org) ou d'un conseiller.";

export const SAVINGS_PRODUCTS: SavingsProduct[] = [
  {
    id: "livret-a", name: "Livret A", category: "Épargne réglementée", risk: 1, liquidity: "Immédiate (retrait à tout moment)",
    ceiling: "22 950 € pour une personne", tax: "Intérêts exonérés d'impôt sur le revenu et de prélèvements sociaux", horizon: "Court terme",
    summary: "Le livret de base : capital garanti, disponible à tout moment, taux fixé par l'État.",
    suitableFor: "Constituer une épargne de précaution (3 à 6 mois de dépenses) et les projets à court terme.",
    watchOut: ["Le taux est révisé deux fois par an (1er février et 1er août) et peut baisser.", "Le rendement peut être inférieur à l'inflation."], rateRef: "livretA",
  },
  {
    id: "ldds", name: "Livret de développement durable et solidaire (LDDS)", category: "Épargne réglementée", risk: 1, liquidity: "Immédiate",
    ceiling: "12 000 € pour une personne", tax: "Intérêts exonérés d'impôt sur le revenu et de prélèvements sociaux", horizon: "Court terme",
    summary: "Même taux que le Livret A, avec un plafond plus bas : un complément quand le Livret A est plein.",
    suitableFor: "Compléter l'épargne de précaution une fois le plafond du Livret A atteint.",
    watchOut: ["Le taux suit celui du Livret A et peut baisser."], rateRef: "ldds",
  },
  {
    id: "lep", name: "Livret d'épargne populaire (LEP)", category: "Épargne réglementée", risk: 1, liquidity: "Immédiate",
    ceiling: "10 000 € pour une personne", tax: "Intérêts exonérés d'impôt sur le revenu et de prélèvements sociaux", horizon: "Court terme",
    summary: "Livret à taux plus avantageux, réservé aux foyers dont le revenu fiscal de référence est sous un plafond.",
    suitableFor: "Les foyers éligibles : c'est le livret réglementé le mieux rémunéré, à ouvrir en priorité s'il est accessible.",
    watchOut: ["Éligibilité à vérifier chaque année selon le revenu fiscal de référence.", "Le taux est révisé deux fois par an."], rateRef: "lep",
  },
  {
    id: "pel", name: "Plan d'épargne logement (PEL)", category: "Épargne réglementée", risk: 1, liquidity: "Bloqué : au moins 4 ans (un retrait avant 4 ans entraîne la clôture)",
    ceiling: "61 200 € de versements", tax: "Intérêts soumis au prélèvement forfaitaire unique (impôt et prélèvements sociaux, taux en vigueur)", horizon: "4 à 10 ans",
    summary: "Épargne à taux fixe pendant toute la durée du plan : le taux est celui de l'année d'ouverture.",
    suitableFor: "Épargner régulièrement et durablement avec un taux connu à l'avance.",
    watchOut: ["Versement initial et versements mensuels minimaux à respecter.", "Le taux d'un plan ouvert une année donnée ne change plus : comparez avec les livrets avant d'ouvrir."], rateRef: "pel",
  },
  {
    id: "assurance-vie-euros", name: "Assurance-vie (fonds en euros)", category: "Placements financiers", risk: 2, liquidity: "Rachat possible, quelques jours à quelques semaines",
    ceiling: null, tax: "Fiscalité allégée après 8 ans (abattement annuel sur les gains) ; conditions successorales avantageuses", horizon: "8 ans et plus",
    summary: "Capital garanti par l'assureur sur le fonds en euros ; le rendement varie chaque année.",
    suitableFor: "Épargne de moyen/long terme prudente, préparation de la transmission.",
    watchOut: ["Frais (versement, gestion) à comparer.", "Le rendement n'est pas garanti d'une année sur l'autre.", "Les unités de compte, elles, peuvent perdre de la valeur."], rateRef: null,
  },
  {
    id: "pea", name: "Plan d'épargne en actions (PEA)", category: "Placements financiers", risk: 4, liquidity: "Possible, mais un retrait avant 5 ans entraîne en principe la clôture",
    ceiling: "150 000 € de versements", tax: "Gains exonérés d'impôt sur le revenu après 5 ans (prélèvements sociaux dus)", horizon: "5 ans et plus, idéalement 8 ans et plus",
    summary: "Enveloppe fiscale pour investir en actions européennes, directement ou via des fonds indiciels (ETF).",
    suitableFor: "Épargnants acceptant les variations de la Bourse, avec un horizon long.",
    watchOut: ["Perte en capital possible, parfois importante à court terme.", "Ne pas investir l'épargne de précaution."], rateRef: null,
  },
  {
    id: "etf", name: "Fonds indiciels cotés (ETF)", category: "Placements financiers", risk: 4, liquidity: "Revente en Bourse en quelques jours",
    ceiling: null, tax: "Selon l'enveloppe (PEA, compte-titres, assurance-vie)", horizon: "8 ans et plus",
    summary: "Un panier diversifié d'actions ou d'obligations qui suit un indice, à frais réduits.",
    suitableFor: "Diversifier simplement, à long terme, avec des versements réguliers.",
    watchOut: ["La valeur fluctue : perte en capital possible.", "Vérifier les frais, l'indice suivi et la devise."], rateRef: null,
  },
  {
    id: "obligations-etat", name: "Obligations d'État (ex. OAT)", category: "Placements financiers", risk: 2, liquidity: "Revente possible avant l'échéance, au prix du marché",
    ceiling: null, tax: "Intérêts imposables (prélèvement forfaitaire unique ou barème)", horizon: "Jusqu'à l'échéance",
    summary: "Prêt à l'État pour une durée donnée contre des intérêts connus d'avance.",
    suitableFor: "Épargnants cherchant des revenus prévisibles, en conservant le titre jusqu'à l'échéance.",
    watchOut: ["Si vous vendez avant l'échéance, le prix peut être inférieur à celui d'achat (hausse des taux).", "Risque de défaut de l'émetteur, faible pour les grands États."], rateRef: null,
  },
  {
    id: "scpi", name: "SCPI (pierre-papier)", category: "Immobilier", risk: 4, liquidity: "Faible : la revente des parts n'est pas garantie",
    ceiling: null, tax: "Revenus fonciers imposés au barème de l'impôt sur le revenu et prélèvements sociaux", horizon: "8 ans et plus",
    summary: "Détenir des parts d'un parc immobilier géré par une société, contre des loyers distribués.",
    suitableFor: "Épargnants à long terme souhaitant diversifier vers l'immobilier sans gérer un bien.",
    watchOut: ["Frais d'entrée élevés.", "Rendement et valeur des parts non garantis ; perte en capital possible.", "Revente parfois longue."], rateRef: null,
  },
];
