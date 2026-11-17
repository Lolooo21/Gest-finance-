import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { detectRuleDrifts, occurrences } from "@gest-finance/finance-core";
import { SubscriptionDismissDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SubscriptionsService } from "./subscriptions.service.js";

const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * 86_400_000));

/**
 * Abonnements et récurrences oubliées détectés dans l'historique, et hausses de prix des récurrences existantes.
 * Ajouter un abonnement passe par POST /recurring-rules (à partir de la prochaine échéance) ; ignorer est mémorisé par foyer.
 */
@Controller("subscriptions")
@UseGuards(AuthGuard)
export class SubscriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.subscriptions.overview(user.householdId);
  }

  @Post("dismiss")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async dismiss(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SubscriptionDismissDto)) dto: SubscriptionDismissDto) {
    await this.prisma.subscriptionDismissal.upsert({
      where: { householdId_key: { householdId: user.householdId, key: dto.key } },
      update: {},
      create: { householdId: user.householdId, key: dto.key },
    });
    await this.audit.record(user.householdId, user.userId, "subscription.dismissed");
  }

  /** Réaffiche toutes les propositions ignorées. */
  @Delete("dismissed")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async restore(@CurrentUser() user: AuthUser) {
    await this.prisma.subscriptionDismissal.deleteMany({ where: { householdId: user.householdId } });
    await this.audit.record(user.householdId, user.userId, "subscription.restored");
  }

  /**
   * Applique le nouveau prix d'une récurrence sans réécrire le passé : l'ancienne règle s'arrête la veille de l'échéance que
   * le prélèvement réel remplace (il la compte déjà), une nouvelle règle au nouveau montant reprend à l'échéance suivante.
   * L'écart est recalculé ici : rien n'est repris du client.
   */
  @Post("drifts/:ruleId/apply")
  @Roles("OWNER", "ADULT")
  async applyDrift(@CurrentUser() user: AuthUser, @Param("ruleId", ParseUUIDPipe) ruleId: string) {
    const data = await this.subscriptions.load(user.householdId);
    const rule = data.rules.find((r) => r.id === ruleId);
    const drift = rule ? detectRuleDrifts(data.transactions, [rule], data.today)[0] : undefined;
    if (!rule || !drift) throw new NotFoundException("Aucun changement de prix à appliquer pour cette récurrence");
    const next = occurrences(rule, addDays(drift.occurrence, 1), addDays(drift.occurrence, 400)).map(toIso)[0];

    const created = await this.prisma.$householdTransaction(async (tx) => {
      if (rule.start >= drift.occurrence) {
        await tx.recurringRule.delete({ where: { id: rule.id } });
      } else {
        await tx.recurringRule.update({ where: { id: rule.id }, data: { end: toDate(addDays(drift.occurrence, -1)) } });
      }
      if (!next || (rule.end && next > rule.end)) return null;
      return tx.recurringRule.create({
        data: {
          householdId: user.householdId, accountId: rule.accountId, label: rule.label, amountCents: drift.observedAmountCents,
          frequency: rule.frequency, start: toDate(next), end: rule.end ? toDate(rule.end) : null, categoryId: rule.categoryId,
        },
      });
    });
    await this.audit.record(user.householdId, user.userId, "subscription.price_updated");
    return { ruleId: created?.id ?? null, start: next ?? null };
  }
}
