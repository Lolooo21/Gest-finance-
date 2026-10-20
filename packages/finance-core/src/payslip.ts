/**
 * Lecture d'une fiche de paie à partir de son texte (extrait d'un PDF numérique).
 * Fonction pure : ne renvoie jamais de valeur devinée. Un champ introuvable vaut `null` et produit un avertissement ;
 * la validation humaine reste obligatoire avant tout enregistrement.
 */
export interface PayslipExtraction {
  /** Net réellement versé (après prélèvement à la source quand il est indiqué), en centimes. */
  netToPayCents: number | null;
  grossCents: number | null;
  /** Mois de la paie, AAAA-MM. */
  periodMonth: string | null;
  employer: string | null;
  /** 0 à 1 : indice de fiabilité, pas une garantie. */
  confidence: number;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

/**
 * Minuscules, sans accents. Tous les espaces typographiques (insécable U+00A0, fine insécable U+202F, etc.)
 * deviennent des espaces simples, et les suites d'espaces sont réduites : les PDF français écrivent « 2 285,40 »
 * avec une espace insécable, que la lecture doit reconnaître comme un séparateur de milliers.
 */
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
    .replace(/[^\S\n]+/g, " ");

const AMOUNT = String.raw`(\d{1,3}(?:[ .]\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:[ ,]\d{3})+\.\d{2}|\d+\.\d{2})`;

/** « 2 345,67 » → 234567 ; renvoie null si le format est inattendu. */
export function parseAmountCents(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  const decimalAt = Math.max(comma, dot);
  if (decimalAt < 0 || s.length - decimalAt - 1 !== 2) return null;
  const whole = s.slice(0, decimalAt).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const cents = Number(whole) * 100 + Number(s.slice(decimalAt + 1));
  return Number.isSafeInteger(cents) && cents <= 2_000_000_000 ? cents : null;
}

/** Premier montant qui suit l'un des libellés (par ordre de priorité). */
function amountAfter(text: string, labels: string[]): { cents: number; label: string } | null {
  for (const label of labels) {
    const m = new RegExp(`${label}[^\\d]{0,60}?${AMOUNT}`).exec(text);
    const cents = m ? parseAmountCents(m[1]!) : null;
    if (cents !== null) return { cents, label };
  }
  return null;
}

function findPeriod(text: string): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  // « du 01/03/2026 au 31/03/2026 », « 01/03/2026 - 31/03/2026 » : une plage d'environ un mois, avec ou sans le mot « période ».
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:au|a|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) {
    const start = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const end = Date.UTC(Number(m[6]), Number(m[5]) - 1, Number(m[4]));
    const days = (end - start) / 86_400_000;
    if (days >= 0 && days <= 35) return `${m[6]}-${pad(Number(m[5]))}`;
  }
  const slash = /(?:periode|paie|bulletin|salaire|mois)[^\d\n]{0,25}(\d{1,2})\/(\d{4})/.exec(text);
  if (slash && Number(slash[1]) >= 1 && Number(slash[1]) <= 12) return `${slash[2]}-${pad(Number(slash[1]))}`;
  const named = new RegExp(`(?:mois|bulletin|periode|paie|salaire)[^\\d\\n]{0,30}?(${Object.keys(MONTHS).join("|")})[ \\-/]*(\\d{4})`).exec(text);
  if (named) return `${named[2]}-${pad(MONTHS[named[1]!]!)}`;
  return null;
}

const LEGAL_FORM = /^\s*([^\n\d]{0,60}\b(?:sas|sasu|sarl|eurl|sci|scop|selarl|association|mairie|commune|ets|etablissements?)\b[^\n\d]{0,40})$/im;

function findEmployer(original: string): string | null {
  const labelled = /(?:employeur|raison\s+sociale|entreprise|soci[eé]t[eé])\s*:?\s*([^\n\d]{2,80})/i.exec(original);
  const fallback = LEGAL_FORM.exec(original.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const name = (labelled?.[1] ?? fallback?.[1])?.replace(/\s+/g, " ").trim();
  return name && name.length >= 2 ? name.slice(0, 80) : null;
}

export function parsePayslip(original: string): PayslipExtraction {
  const text = normalize(original);
  const warnings: string[] = [];

  const net = amountAfter(text, ["net paye", "net a payer apres impot", "net a payer au salarie", "net a verser", "net a payer avant impot", "net a payer", "net verse", "net percu"]);
  if (!net) warnings.push("Net à payer introuvable : saisissez-le manuellement.");
  else if (net.label === "net a payer avant impot") warnings.push("Seul le net avant impôt sur le revenu a été trouvé : le montant réellement versé peut être inférieur.");

  const gross = amountAfter(text, ["salaire brut", "total brut", "remuneration brute", "brut mensuel", "\\bbrut\\b"]);
  if (!gross) warnings.push("Salaire brut introuvable.");

  const periodMonth = findPeriod(text);
  if (!periodMonth) warnings.push("Période de paie introuvable.");

  const employer = findEmployer(original);

  let confidence = (net ? 0.5 : 0) + (gross ? 0.2 : 0) + (periodMonth ? 0.2 : 0) + (employer ? 0.1 : 0);
  if (net && gross) {
    if (net.cents > gross.cents) {
      warnings.push("Le net est supérieur au brut : vérifiez les montants.");
      confidence -= 0.3;
    } else if (net.cents < gross.cents * 0.2) {
      warnings.push("Le net est très inférieur au brut : vérifiez les montants.");
      confidence -= 0.2;
    }
  }

  return {
    netToPayCents: net?.cents ?? null,
    grossCents: gross?.cents ?? null,
    periodMonth,
    employer,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    warnings,
  };
}
