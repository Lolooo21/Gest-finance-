import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { AccountDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
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

  /** Renvoie les comptes avec le solde courant (solde initial + opérations) et l'IBAN masqué : l'IBAN complet ne quitte jamais l'API. */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const accounts = await this.prisma.bankAccount.findMany({ where: { householdId: user.householdId }, orderBy: { createdAt: "asc" } });
    const sums = await this.prisma.transaction.groupBy({ by: ["accountId"], where: { householdId: user.householdId }, _sum: { amountCents: true } });
    const byAccount = new Map(sums.map((s) => [s.accountId, s._sum.amountCents ?? 0]));
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: a.initialBalanceCents + (byAccount.get(a.id) ?? 0),
      ibanMasked: a.ibanEncrypted ? maskIban(this.crypto.decrypt(a.ibanEncrypted)) : null,
    }));
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AccountDto)) dto: AccountDto) {
    const account = await this.prisma.bankAccount.create({
      data: {
        householdId: user.householdId,
        name: dto.name,
        type: dto.type,
        initialBalanceCents: dto.initialBalanceCents,
        ibanEncrypted: dto.iban ? this.crypto.encrypt(dto.iban) : null,
      },
    });
    await this.audit.record(user.householdId, user.userId, "account.created");
    return { id: account.id, name: account.name, type: account.type, balanceCents: account.initialBalanceCents, ibanMasked: dto.iban ? maskIban(dto.iban) : null };
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
