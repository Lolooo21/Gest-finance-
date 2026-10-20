import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { occurrences, resteAVivre, type RecurringRule } from "@gest-finance/finance-core";
import { WeeklyReviewQuery } from "@gest-finance/shared";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * 86_400_000));

@Controller("review")
@UseGuards(AuthGuard)
export class ReviewController {
  constructor(private readonly prisma: PrismaService) {}

  /** Bilan de la semaine : 7 jours se terminant à `to` (aujourd'hui par défaut), plus les 7 jours à venir. */
  @Get("weekly")
  async weekly(@CurrentUser() user: AuthUser, @Query(new ZodPipe(WeeklyReviewQuery)) q: WeeklyReviewQuery) {
    const to = q.to ?? toIso(new Date());
    const from = addDays(to, -6);
    const monthFrom = `${to.slice(0, 7)}-01`;
    const monthTo = toIso(new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)));

    const [txRows, ruleRows, monthTx, accounts] = await Promise.all([
      this.prisma.transaction.findMany({ where: { householdId: user.householdId, date: { gte: toDate(from), lte: toDate(to) } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
      this.prisma.recurringRule.findMany({ where: { householdId: user.householdId } }),
      this.prisma.transaction.findMany({ where: { householdId: user.householdId, date: { gte: toDate(monthFrom), lte: toDate(monthTo) } } }),
      this.prisma.bankAccount.findMany({ where: { householdId: user.householdId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const rules: (RecurringRule & { label: string; accountId: string })[] = ruleRows.map((r) => ({
      id: r.id, label: r.label, accountId: r.accountId, amountCents: r.amountCents, frequency: r.frequency,
      start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}),
    }));
    const expand = (a: string, b: string) =>
      rules.flatMap((r) => occurrences(r, a, b).map((d) => ({ date: toIso(d), label: r.label, account: names.get(r.accountId) ?? "", amountCents: r.amountCents })))
        .sort((x, y) => x.date.localeCompare(y.date));

    const transactions = txRows.map((t) => ({ id: t.id, date: toIso(t.date), label: t.label, account: names.get(t.accountId) ?? "", amountCents: t.amountCents }));
    const recurringInPeriod = expand(from, to);
    const upcoming = expand(addDays(to, 1), addDays(to, 7));
    const all = [...transactions, ...recurringInPeriod];
    return {
      from, to,
      incomeCents: all.filter((x) => x.amountCents > 0).reduce((s, x) => s + x.amountCents, 0),
      expensesCents: all.filter((x) => x.amountCents < 0).reduce((s, x) => s - x.amountCents, 0),
      transactions, recurringInPeriod, upcoming,
      month: { from: monthFrom, to: monthTo, ...resteAVivre(monthFrom, monthTo, rules, monthTx.map((t) => ({ date: toIso(t.date), amountCents: t.amountCents }))) },
    };
  }
}
