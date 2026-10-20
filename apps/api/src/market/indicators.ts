/** Indicateurs de marché récupérés automatiquement. Les URL sont des constantes : aucune adresse n'est jamais fournie par un utilisateur. */
export interface IndicatorSource {
  key: "ECB_DEPOSIT_RATE" | "FR_10Y_YIELD" | "FR_INFLATION";
  label: string;
  explanation: string;
  source: string;
  /** Page lisible par un humain pour vérifier la valeur. */
  sourceUrl: string;
  /** Adresses candidates, essayées dans l'ordre : la première qui répond est retenue. */
  urls: string[];
  /** Bornes de vraisemblance en points de base : une valeur hors bornes est rejetée. */
  minBp: number;
  maxBp: number;
}

export const ALLOWED_HOSTS = ["data-api.ecb.europa.eu", "ec.europa.eu"];

export const INDICATORS: IndicatorSource[] = [
  {
    key: "ECB_DEPOSIT_RATE",
    label: "Taux de dépôt de la BCE",
    explanation: "Taux directeur qui oriente le coût du crédit et la rémunération de l'épargne en zone euro.",
    source: "Banque centrale européenne",
    sourceUrl: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.fr.html",
    urls: ["https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=csvdata"],
    minBp: -200,
    maxBp: 2500,
  },
  {
    key: "FR_10Y_YIELD",
    label: "Taux des obligations d'État françaises à 10 ans (OAT)",
    explanation: "Référence du taux d'emprunt à long terme : il influence les taux des crédits immobiliers.",
    source: "BCE / Eurostat",
    sourceUrl: "https://data.ecb.europa.eu/data/datasets/IRS",
    urls: [
      // Maturité « 0000 » (la forme « 0 » renvoie une erreur 404). Repli : rendement des obligations d'État à 10 ans (critère de convergence), Eurostat.
      "https://data-api.ecb.europa.eu/service/data/IRS/M.FR.L.L40.CI.0000.EUR.N.Z?lastNObservations=1&format=csvdata",
      "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/irt_lt_mcby_m/M.MCBY.FR?lastNObservations=1&format=SDMX-CSV",
    ],
    minBp: -200,
    maxBp: 2500,
  },
  {
    key: "FR_INFLATION",
    label: "Inflation en France (IPCH, sur un an)",
    explanation: "Hausse des prix sur un an : un placement doit la dépasser pour préserver votre pouvoir d'achat.",
    source: "Eurostat",
    sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_manr/default/table",
    urls: ["https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hicp_manr/M.RCH_A.CP00.FR?lastNObservations=1&format=SDMX-CSV"],
    minBp: -1000,
    maxBp: 5000,
  },
];
