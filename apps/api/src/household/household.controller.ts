import { Body, ConflictException, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AddMemberDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService, SystemPrismaService } from "../prisma/prisma.service.js";

@Controller("household")
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrismaService,
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
    // Unicité de l'e-mail sur tous les foyers : la RLS cache les autres foyers, donc contrôle par le client système.
    if (await this.system.user.findUnique({ where: { email: dto.email }, select: { id: true } })) throw new ConflictException("Ajout impossible");
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
