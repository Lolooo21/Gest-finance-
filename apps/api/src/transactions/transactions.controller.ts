import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { TransactionDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

const view = (t: { id: string; accountId: string; amountCents: number; date: Date; label: string }) => ({
  id: t.id, accountId: t.accountId, amountCents: t.amountCents, date: toIso(t.date), label: t.label,
});

@Controller("transactions")
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = await this.prisma.transaction.findMany({ where: { householdId: user.householdId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take });
    return rows.map(view);
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TransactionDto)) dto: TransactionDto) {
    // Le compte référencé doit appartenir au foyer du jeton (sinon IDOR via accountId).
    const account = await this.prisma.bankAccount.findFirst({ where: { id: dto.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");
    const t = await this.prisma.transaction.create({
      data: { householdId: user.householdId, accountId: dto.accountId, amountCents: dto.amountCents, date: toDate(dto.date), label: dto.label },
    });
    await this.audit.record(user.householdId, user.userId, "transaction.created");
    return view(t);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.transaction.deleteMany({ where: { id, householdId: user.householdId } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "transaction.deleted");
  }
}
