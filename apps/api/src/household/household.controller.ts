import { Body, ConflictException, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AddMemberDto, AuditQuery, MemberPasswordDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService, SystemPrismaService } from "../prisma/prisma.service.js";

/** Entrées du journal d'activité par page. */
const AUDIT_PAGE = 50;

@Controller("household")
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** L'utilisateur connecté : le front adapte l'écran à son rôle (administration du foyer pour le propriétaire). */
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { id: true, email: true, displayName: true, role: true } });
  }

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
  async auditLog(@CurrentUser() user: AuthUser, @Query(new ZodPipe(AuditQuery)) q: AuditQuery) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        householdId: user.householdId,
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
        ...(q.security ? { action: { startsWith: "auth." } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: AUDIT_PAGE + 1,
      select: { id: true, userId: true, action: true, createdAt: true },
    });
    const page = rows.slice(0, AUDIT_PAGE);
    const people = await this.prisma.user.findMany({ where: { householdId: user.householdId }, select: { id: true, displayName: true } });
    const name = new Map(people.map((p) => [p.id, p.displayName]));
    return {
      entries: page.map((r) => ({ id: r.id, action: r.action, createdAt: r.createdAt.toISOString(), user: r.userId ? (name.get(r.userId) ?? null) : null })),
      // Page suivante : les entrées plus anciennes que la dernière affichée.
      next: rows.length > AUDIT_PAGE ? page.at(-1)!.createdAt.toISOString() : null,
    };
  }

  @Post("members/:id/password")
  @HttpCode(200)
  @Roles("OWNER")
  async resetMemberPassword(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(MemberPasswordDto)) dto: MemberPasswordDto) {
    await this.auth.resetMemberPassword(user.userId, id, dto);
    return { ok: true };
  }

  @Post("members")
  @Roles("OWNER")
  async addMember(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AddMemberDto)) dto: AddMemberDto) {
    // Unicité de l'e-mail sur tous les foyers : la RLS cache les autres foyers, donc contrôle par le client système.
    this.auth.assertStrongPassword(dto.password, [dto.email, dto.displayName]);
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
