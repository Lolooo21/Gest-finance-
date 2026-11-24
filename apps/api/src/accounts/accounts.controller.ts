import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { accountBalanceAt } from "@gest-finance/finance-core";
import { AccountDto, AccountPatch } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CryptoService } from "../crypto/crypto.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const maskIban = (iban: string) => `${iban.slice(0, 4)}••••${iban.slice(-4)}`;

@Controller("accounts")
@UseGuards(AuthGuard)
export class AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Renvoie les comptes visibles (joints et personnels de l'utilisateur, filtrés par la RLS) avec le solde d'aujourd'hui
   * (solde initial + opérations datées jusqu'à aujourd'hui + occurrences récurrentes échues), le solde prévu en fin de mois
   * (mêmes éléments jusqu'au dernier jour du mois) et l'IBAN masqué : l'IBAN complet ne quitte jamais l'API.
   */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const accounts = await this.prisma.bankAccount.findMany({ where: { householdId: user.householdId }, orderBy: { createdAt: "asc" } });
    // Solde d'aujourd'hui : les opérations datées dans le futur et les occurrences à venir n'y sont PAS ; elles s'ajoutent au solde de fin de mois.
    const today = toIso(new Date());
    const endOfMonth = toIso(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)));
    const sumsUntil = async (date: string) => new Map((await this.prisma.transaction.groupBy({
      by: ["accountId"], where: { householdId: user.householdId, date: { lte: toDate(date) } }, _sum: { amountCents: true },
    })).map((s) => [s.accountId, s._sum.amountCents ?? 0]));
    const [untilToday, untilEndOfMonth] = await Promise.all([sumsUntil(today), sumsUntil(endOfMonth)]);
    const rules = (await this.prisma.recurringRule.findMany({ where: { householdId: user.householdId } }))
      .map((r) => ({ id: r.id, accountId: r.accountId, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}) }));
    const balanceAt = (accountId: string, initialCents: number, date: string, sums: Map<string, number>) =>
      accountBalanceAt(date, initialCents + (sums.get(accountId) ?? 0), rules.filter((r) => r.accountId === accountId), []);
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: balanceAt(a.id, a.initialBalanceCents, today, untilToday),
      endOfMonthCents: balanceAt(a.id, a.initialBalanceCents, endOfMonth, untilEndOfMonth),
      ibanMasked: a.ibanEncrypted ? maskIban(this.crypto.decrypt(a.ibanEncrypted)) : null,
      personal: a.ownerId !== null,
      color: a.color,
    }));
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AccountDto)) dto: AccountDto) {
    const account = await this.prisma.bankAccount.create({
      data: {
        householdId: user.householdId,
        ownerId: dto.personal ? user.userId : null,
        name: dto.name,
        type: dto.type,
        initialBalanceCents: dto.initialBalanceCents,
        ibanEncrypted: dto.iban ? this.crypto.encrypt(dto.iban) : null,
        color: dto.color ?? null,
      },
    });
    await this.audit.record(user.householdId, user.userId, dto.personal ? "account.created:personal" : "account.created");
    return {
      id: account.id, name: account.name, type: account.type, balanceCents: account.initialBalanceCents, endOfMonthCents: account.initialBalanceCents,
      ibanMasked: dto.iban ? maskIban(dto.iban) : null, personal: account.ownerId !== null, color: account.color,
    };
  }

  @Patch(":id")
  @Roles("OWNER", "ADULT")
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(AccountPatch)) dto: AccountPatch) {
    const { iban, personal, balanceCents, ...fields } = dto;
    const account = await this.prisma.bankAccount.findFirst({ where: { id, householdId: user.householdId }, select: { ownerId: true, initialBalanceCents: true } });
    if (!account) throw new NotFoundException();
    // Solde corrigé : on décale le solde initial de l'écart avec le solde calculé d'aujourd'hui (aucune opération créée).
    if (balanceCents !== undefined) {
      const current = (await this.list(user)).find((a) => a.id === id);
      if (!current) throw new NotFoundException();
      fields.initialBalanceCents = (fields.initialBalanceCents ?? account.initialBalanceCents) + balanceCents - current.balanceCents;
    }
    // Rendre personnel un compte joint le retire à tout le foyer : réservé au propriétaire du foyer.
    if (personal && account.ownerId === null && user.role !== "OWNER") {
      throw new ForbiddenException("Seul le propriétaire du foyer peut rendre personnel un compte joint.");
    }
    const ownership = personal === undefined || personal === (account.ownerId !== null) ? {} : { ownerId: personal ? user.userId : null };
    const { count } = await this.prisma.bankAccount.updateMany({
      where: { id, householdId: user.householdId },
      data: { ...fields, ...ownership, ...(iban ? { ibanEncrypted: this.crypto.encrypt(iban) } : {}) },
    });
    if (!count) throw new NotFoundException();
    const action = "ownerId" in ownership ? (personal ? "account.made_personal" : "account.shared") : balanceCents !== undefined ? "account.balance_adjusted" : "account.updated";
    await this.audit.record(user.householdId, user.userId, action);
    return { ok: true };
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.bankAccount.deleteMany({ where: { id, householdId: user.householdId } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "account.deleted");
  }
}
