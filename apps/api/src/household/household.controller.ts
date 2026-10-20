import { Body, ConflictException, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AddMemberDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("household")
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** Toutes les requêtes sont filtrées par le householdId du jeton, jamais par un paramètre client. */
  @Get("members")
  members(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({
      where: { householdId: user.householdId },
      select: { id: true, email: true, displayName: true, role: true },
    });
  }

  @Get("audit")
  @Roles("OWNER")
  auditLog(@CurrentUser() user: AuthUser) {
    return this.prisma.auditLog.findMany({
      where: { householdId: user.householdId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, userId: true, action: true, createdAt: true },
    });
  }

  @Post("members")
  @Roles("OWNER")
  async addMember(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AddMemberDto)) dto: AddMemberDto) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException("Ajout impossible");
    const member = await this.prisma.user.create({
      data: {
        householdId: user.householdId,
        email: dto.email,
        displayName: dto.displayName,
        role: dto.role,
        passwordHash: await this.auth.hashPassword(dto.password),
      },
      select: { id: true, email: true, displayName: true, role: true },
    });
    await this.audit.record(user.householdId, user.userId, `household.member_added:${dto.role}`);
    return member;
  }
}
