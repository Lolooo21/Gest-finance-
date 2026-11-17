import { Injectable } from "@nestjs/common";
import { labelPattern, suggestCategory, trainClassifier, type CategoryRuleInput, type Suggestion } from "@gest-finance/finance-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { CategoriesService } from "./categories.service.js";

/** Opérations classées les plus récentes servant à entraîner le classifieur (suffisant pour un foyer, borne le coût). */
const TRAINING_LIMIT = 3000;

/**
 * Catégorisation automatique du foyer : règles (saisies ou apprises) puis classifieur local entraîné sur les opérations classées.
 * Rien ne sort du serveur. Une règle apprise suit la dernière correction ; une règle saisie n'est jamais écrasée.
 */
@Injectable()
export class CategorizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /** Charge règles et historique une fois, puis propose une catégorie par libellé. */
  async load(householdId: string): Promise<(label: string) => Suggestion | null> {
    const [rules, examples] = await Promise.all([
      this.prisma.categoryRule.findMany({ where: { householdId } }),
      this.prisma.transaction.findMany({
        where: { householdId, categoryId: { not: null } },
        select: { label: true, categoryId: true },
        orderBy: { date: "desc" },
        take: TRAINING_LIMIT,
      }),
    ]);
    const input: CategoryRuleInput[] = rules.map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.categoryId, source: r.source, hits: r.hits }));
    const model = trainClassifier(examples.map((e) => ({ label: e.label, categoryId: e.categoryId! })));
    return (label) => suggestCategory(label, input, model);
  }

  /**
   * Catégorie à enregistrer pour une nouvelle opération : `undefined` = automatique (proposition, sinon aucune),
   * `null` = sans catégorie, identifiant = choix de l'utilisateur (vérifié, puis appris).
   */
  async resolve(householdId: string, label: string, categoryId: string | null | undefined): Promise<string | null> {
    if (categoryId === undefined) return (await this.load(householdId))(label)?.categoryId ?? null;
    if (categoryId === null) return null;
    await this.categories.assertCategory(householdId, categoryId);
    await this.learn(householdId, [{ label, categoryId }]);
    return categoryId;
  }

  /** Apprend des classements faits par un adulte : le mot-clé du libellé pointe désormais vers la catégorie choisie. */
  async learn(householdId: string, choices: { label: string; categoryId: string }[]) {
    // Un même mot-clé classé plusieurs fois dans le lot : le dernier choix l'emporte.
    const byPattern = new Map<string, string>();
    for (const c of choices) {
      const pattern = labelPattern(c.label);
      if (pattern) byPattern.set(pattern, c.categoryId);
    }
    for (const [pattern, categoryId] of byPattern) {
      const existing = await this.prisma.categoryRule.findUnique({ where: { householdId_pattern: { householdId, pattern } } });
      if (!existing) {
        await this.prisma.categoryRule.create({ data: { householdId, pattern, categoryId, source: "LEARNED", hits: 1 } });
      } else if (existing.source === "LEARNED") {
        await this.prisma.categoryRule.update({
          where: { id: existing.id },
          data: existing.categoryId === categoryId ? { hits: { increment: 1 } } : { categoryId, hits: 1 },
        });
      }
    }
  }

  /** Classe les opérations sans catégorie qui ont une proposition ; renvoie le nombre d'opérations classées. */
  async applyToUncategorized(householdId: string): Promise<number> {
    const suggest = await this.load(householdId);
    const rows = await this.prisma.transaction.findMany({ where: { householdId, categoryId: null }, select: { id: true, label: true } });
    const byCategory = new Map<string, string[]>();
    for (const t of rows) {
      const s = suggest(t.label);
      if (s) byCategory.set(s.categoryId, [...(byCategory.get(s.categoryId) ?? []), t.id]);
    }
    let count = 0;
    for (const [categoryId, ids] of byCategory) {
      count += (await this.prisma.transaction.updateMany({ where: { householdId, id: { in: ids }, categoryId: null }, data: { categoryId } })).count;
    }
    return count;
  }
}
