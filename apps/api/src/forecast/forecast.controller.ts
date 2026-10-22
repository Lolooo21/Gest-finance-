import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { accountBalanceAt, projectBalance } from "@gest-finance/finance-core";
import { ForecastQuery } from "@gest-finance/shared";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toIso } from "../common/dates.js";
import { loadHouseholdFinance } from "../common/finance-data.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("forecast")
@UseGuards(AuthGuard)
export class ForecastController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Solde projeté à 30, 60 ou 90 jours. Départ : solde à la fin d'aujourd'hui (solde initial + opérations jusqu'à aujourd'hui + occurrences
   * échues) ; ensuite, règles récurrentes à venir et opérations déjà saisies avec une date future. Recalculé à chaque appel.
   */
  @Get()
  async forecast(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ForecastQuery)) q: ForecastQuery) {
    const today = toIso(new Date());
    const data = await loadHouseholdFinance(this.prisma, user.householdId);
    const accounts = data.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      balanceCents: accountBalanceAt(today, a.initialCents, data.rules.filter((r) => r.accountId === a.id), data.oneOffs.filter((t) => t.accountId === a.id)),
    }));
    const forecast = projectBalance({ today, days: q.days, accounts, rules: data.rules, oneOffs: data.oneOffs });
    const names = new Map(data.accounts.map((a) => [a.id, a]));
    return {
      ...forecast,
      days: q.days,
      accounts: forecast.accounts.map((a) => ({ ...a, name: names.get(a.id)?.name ?? "", type: names.get(a.id)?.type ?? "CHECKING" })),
      events: forecast.events.map((e) => ({ ...e, account: names.get(e.accountId)?.name ?? "" })),
    };
  }
}
