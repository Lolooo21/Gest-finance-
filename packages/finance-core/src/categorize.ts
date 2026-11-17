import { normalizeLabel } from "./statements.js";

/**
 * Catégorisation automatique, 100 % locale : règles « mot-clé → catégorie » (saisies ou apprises des corrections),
 * puis, en repli, un classifieur bayésien naïf entraîné sur les opérations déjà classées du foyer. Fonctions pures.
 */

/** Mots des libellés bancaires qui ne désignent pas le commerçant (moyen de paiement, liaisons, mois…). */
const NOISE = new Set([
  "cb", "carte", "prlv", "prelevement", "sepa", "vir", "virement", "recu", "emis", "inst", "instantane", "paiement", "achat", "retrait",
  "dab", "facture", "fact", "echeance", "ech", "ref", "mandat", "remise", "cheque", "chq", "tip", "frais", "par", "pour", "avec", "sur",
  "the", "les", "des", "une", "aux", "chez", "sas", "sarl", "eurl", "france", "fr", "paris", "eur", "euro", "euros", "date", "num",
  "janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
]);

/** Mots significatifs d'un libellé : normalisés, sans chiffres, sans bruit bancaire, 3 lettres au moins. */
export function significantTokens(label: string): string[] {
  return normalizeLabel(label)
    .split(" ")
    .filter((w) => w.length >= 3 && !/\d/.test(w) && !NOISE.has(w));
}

/**
 * Mot-clé appris d'un libellé : son premier mot significatif, en général le commerçant
 * (« CB CARREFOUR EVRY 12/11 » → « carrefour », « PRLV SEPA FREE MOBILE » → « free »). Null si le libellé n'en a pas.
 */
export function labelPattern(label: string): string | null {
  return significantTokens(label)[0] ?? null;
}

/** Mot-clé d'une règle saisie : un ou plusieurs mots, normalisés (« Free Mobile » → « free mobile »). */
export const normalizePattern = (pattern: string): string => normalizeLabel(pattern);

export interface CategoryRuleInput {
  id: string;
  /** Mot-clé normalisé (un ou plusieurs mots). */
  pattern: string;
  categoryId: string;
  /** MANUAL : saisie par un adulte ; LEARNED : apprise d'une correction. */
  source: "MANUAL" | "LEARNED";
  hits: number;
}

/** Le libellé contient-il le mot-clé comme suite de mots entiers ? (« free » ne correspond pas à « freebox ») */
export function patternMatches(pattern: string, label: string): boolean {
  return pattern !== "" && ` ${normalizeLabel(label)} `.includes(` ${pattern} `);
}

/** Meilleure règle pour un libellé : une règle saisie passe avant une règle apprise, puis le mot-clé le plus long, puis la plus utilisée. */
export function matchRule(label: string, rules: CategoryRuleInput[]): CategoryRuleInput | null {
  return rules
    .filter((r) => patternMatches(r.pattern, label))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "MANUAL" ? -1 : 1) || b.pattern.length - a.pattern.length || b.hits - a.hits)[0] ?? null;
}

export interface ClassifierModel {
  /** Nombre d'exemples par catégorie. */
  docs: Record<string, number>;
  /** Occurrences de chaque mot par catégorie. */
  words: Record<string, Record<string, number>>;
  /** Nombre total de mots par catégorie. */
  totals: Record<string, number>;
  vocabulary: number;
  examples: number;
}

/** Entraîne le classifieur sur les opérations déjà classées (libellé → catégorie). */
export function trainClassifier(examples: { label: string; categoryId: string }[]): ClassifierModel {
  const model: ClassifierModel = { docs: {}, words: {}, totals: {}, vocabulary: 0, examples: 0 };
  const vocab = new Set<string>();
  for (const { label, categoryId } of examples) {
    const tokens = significantTokens(label);
    if (tokens.length === 0) continue;
    model.examples++;
    model.docs[categoryId] = (model.docs[categoryId] ?? 0) + 1;
    const counts = (model.words[categoryId] ??= {});
    for (const t of tokens) {
      counts[t] = (counts[t] ?? 0) + 1;
      model.totals[categoryId] = (model.totals[categoryId] ?? 0) + 1;
      vocab.add(t);
    }
  }
  model.vocabulary = vocab.size;
  return model;
}

/** Seuils du classifieur : assez d'exemples, au moins un mot déjà vu, et une catégorie nettement plus probable. */
export const MIN_EXAMPLES = 5;
export const MIN_PROBABILITY = 0.6;

/** Catégorie la plus probable (bayésien naïf, lissage de Laplace), ou null si le classifieur n'est pas assez sûr. */
export function classify(model: ClassifierModel, label: string): { categoryId: string; probability: number } | null {
  const tokens = significantTokens(label);
  const categories = Object.keys(model.docs);
  if (model.examples < MIN_EXAMPLES || categories.length === 0 || tokens.length === 0) return null;
  if (!tokens.some((t) => categories.some((c) => model.words[c]![t]))) return null;
  const scores = categories.map((c) => {
    let logP = Math.log(model.docs[c]! / model.examples);
    for (const t of tokens) logP += Math.log(((model.words[c]![t] ?? 0) + 1) / (model.totals[c]! + model.vocabulary));
    return { categoryId: c, logP };
  });
  const max = Math.max(...scores.map((s) => s.logP));
  const sum = scores.reduce((acc, s) => acc + Math.exp(s.logP - max), 0);
  const best = scores.reduce((a, b) => (b.logP > a.logP ? b : a));
  const probability = 1 / sum;
  return probability >= MIN_PROBABILITY ? { categoryId: best.categoryId, probability: Math.round(probability * 100) / 100 } : null;
}

export interface Suggestion {
  categoryId: string;
  /** RULE : règle (saisie ou apprise) ; MODEL : classifieur. */
  source: "RULE" | "MODEL";
  ruleId?: string;
}

/** Catégorie proposée pour un libellé : règle d'abord, classifieur ensuite, sinon aucune. */
export function suggestCategory(label: string, rules: CategoryRuleInput[], model: ClassifierModel | null): Suggestion | null {
  const rule = matchRule(label, rules);
  if (rule) return { categoryId: rule.categoryId, source: "RULE", ruleId: rule.id };
  const guess = model ? classify(model, label) : null;
  return guess ? { categoryId: guess.categoryId, source: "MODEL" } : null;
}
