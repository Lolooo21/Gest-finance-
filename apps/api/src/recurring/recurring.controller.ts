import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { RecurringRuleDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

const view = (r: { id: string; accountId: string; label: string; amountCents: number; frequency: string; start: Date; end: Date | null }) => ({
  id: r.id, accountId: r.accountId, label: r.label, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), end: r.end ? toIso(r.end) : null,
});

@Controller("recurring-rules")
@UseGuards(AuthGuard)
export class RecurringController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.recurringRule.findMany({ where: { householdId: user.householdId }, orderBy: { createdAt: "asc" } });
    return rows.map(view);
  }

  @Post()
  @Roles("OWNER", "ADULT")
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(RecurringRuleDto)) dto: RecurringRuleDto) {
    if (dto.end && dto.end < dto.start) throw new BadRequestException("La fin précède le début");
    const account = await this.prisma.bankAccount.findFirst({ where: { id: dto.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");
    const r = await this.prisma.recurringRule.create({
      data: {
        householdId: user.householdId, accountId: dto.accountId, label: dto.label, amountCents: dto.amountCents,
        frequency: dto.frequency, start: toDate(dto.start), end: dto.end ? toDate(dto.end) : null,
      },
    });
    await this.audit.record(user.householdId, user.userId, "recurring_rule.created");
    return view(r);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("OWNER", "ADULT")
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.recurringRule.deleteMany({ where: { id, householdId: user.householdId } });
    if (!count) throw new NotFoundException();
    await this.audit.record(user.householdId, user.userId, "recurring_rule.deleted");
  }
}
