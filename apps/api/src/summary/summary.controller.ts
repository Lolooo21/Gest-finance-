import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { resteAVivre, type RecurringRule } from "@gest-finance/finance-core";
import { SummaryQuery } from "@gest-finance/shared";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { accountFilter } from "../common/finance-data.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("summary")
@UseGuards(AuthGuard)
export class SummaryController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reste à vivre sur [from, to], recalculé à chaque appel à partir des règles et des opérations des comptes visibles
   * (la RLS écarte les comptes personnels des autres membres). `scope` restreint aux comptes joints ou à mes comptes personnels.
   */
  @Get()
  async summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(SummaryQuery)) q: SummaryQuery) {
    const account = accountFilter(q.scope, user.userId);
    const [ruleRows, transactions] = await Promise.all([
      this.prisma.recurringRule.findMany({ where: { householdId: user.householdId, ...account } }),
      this.prisma.transaction.findMany({ where: { householdId: user.householdId, date: { gte: toDate(q.from), lte: toDate(q.to) }, ...account } }),
    ]);
    const rules: RecurringRule[] = ruleRows.map((r) => ({
      id: r.id, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}),
    }));
    return { from: q.from, to: q.to, scope: q.scope, ...resteAVivre(q.from, q.to, rules, transactions.map((t) => ({ date: toIso(t.date), amountCents: t.amountCents }))) };
  }
}
