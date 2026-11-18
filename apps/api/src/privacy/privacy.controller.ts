import { Body, ConflictException, Controller, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ConfirmPasswordDto, DeleteConfirmDto } from "@gest-finance/shared";
import { AuditService } from "../audit/audit.service.js";
import { cookieBase } from "../auth/auth.controller.js";
import { AuthService } from "../auth/auth.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CryptoService } from "../crypto/crypto.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Version du format d'export : à incrémenter si la structure change. */
export const EXPORT_FORMAT = 1;

const clearSession = (res: FastifyReply) => {
  res.clearCookie("access", cookieBase);
  res.clearCookie("refresh", { ...cookieBase, path: "/auth" });
};

/**
 * Droits RGPD : export de ses données (portabilité) et effacement (de son compte, ou du foyer entier pour le propriétaire).
 * Chaque action exige le mot de passe (une erreur compte comme un échec de connexion, avec verrouillage) ; l'effacement exige en
 * plus de taper « SUPPRIMER ». Les sauvegardes chiffrées déjà faites expirent selon leur rétention (voir docs/rgpd.md).
 */
@Controller("privacy")
@UseGuards(AuthGuard)
export class PrivacyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Toutes les données que l'utilisateur peut voir (la RLS écarte les comptes personnels des autres membres), lisibles, IBAN
   * compris. Jamais de secret : ni empreinte de mot de passe, ni secret 2FA, ni jeton de session, ni abonnement push.
   * Le journal d'activité n'est inclus que pour le propriétaire (seul à pouvoir le consulter).
   */
  @Post("export")
  @HttpCode(200)
  async export(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ConfirmPasswordDto)) dto: ConfirmPasswordDto) {
    await this.auth.verifyPassword(user.userId, dto.password);
    const where = { householdId: user.householdId };
    const [household, me, members, accounts, transactions, rules, categories, categoryRules, behaviorGoals, savingsGoals, payslips, dismissals, reminder, passkeys, audit] = await Promise.all([
      this.prisma.household.findUniqueOrThrow({ where: { id: user.householdId }, select: { name: true, createdAt: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { email: true, displayName: true, role: true, totpEnabled: true, createdAt: true } }),
      this.prisma.user.findMany({ where, select: { id: true, displayName: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.bankAccount.findMany({ where, orderBy: { createdAt: "asc" } }),
      this.prisma.transaction.findMany({ where, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
      this.prisma.recurringRule.findMany({ where, orderBy: { createdAt: "asc" } }),
      this.prisma.category.findMany({ where, orderBy: { name: "asc" } }),
      this.prisma.categoryRule.findMany({ where, orderBy: { pattern: "asc" } }),
      this.prisma.behaviorGoal.findMany({ where }),
      this.prisma.savingsGoal.findMany({ where, include: { contributions: { orderBy: { date: "asc" } } }, orderBy: { createdAt: "asc" } }),
      this.prisma.payslipImport.findMany({ where, orderBy: { periodMonth: "asc" } }),
      this.prisma.subscriptionDismissal.findMany({ where }),
      this.prisma.reminderSetting.findUnique({ where: { userId: user.userId } }),
      this.prisma.passkey.findMany({ where: { userId: user.userId }, select: { name: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: "asc" } }),
      user.role === "OWNER" ? this.prisma.auditLog.findMany({ where, orderBy: { createdAt: "asc" } }) : Promise.resolve(null),
    ]);
    await this.audit.record(user.householdId, user.userId, "privacy.exported");
    const date = (d: Date | null) => (d ? toIso(d) : null);
    return {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      notice: "Export Gest-finance : montants en centimes (négatif = sortie), dates AAAA-MM-JJ. Contient des données sensibles : conservez ce fichier en lieu sûr.",
      household: { name: household.name, createdAt: household.createdAt.toISOString() },
      me: { ...me, createdAt: me.createdAt.toISOString() },
      members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      accounts: accounts.map((a) => ({
        id: a.id, name: a.name, type: a.type, personal: a.ownerId !== null, initialBalanceCents: a.initialBalanceCents,
        iban: a.ibanEncrypted ? this.crypto.decrypt(a.ibanEncrypted) : null, createdAt: a.createdAt.toISOString(),
      })),
      transactions: transactions.map((t) => ({ id: t.id, accountId: t.accountId, date: toIso(t.date), amountCents: t.amountCents, label: t.label, categoryId: t.categoryId, imported: t.importHash !== null })),
      recurringRules: rules.map((r) => ({ id: r.id, accountId: r.accountId, label: r.label, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), end: date(r.end), categoryId: r.categoryId })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, monthlyBudgetCents: c.monthlyBudgetCents, rollover: c.rollover, budgetSince: date(c.budgetSince) })),
      categoryRules: categoryRules.map((r) => ({ pattern: r.pattern, categoryId: r.categoryId, source: r.source, hits: r.hits })),
      behaviorGoals: behaviorGoals.map((g) => ({ kind: g.kind, capCents: g.capCents, createdAt: g.createdAt.toISOString() })),
      savingsGoals: savingsGoals.map((g) => ({
        id: g.id, name: g.name, kind: g.kind, targetCents: g.targetCents, targetDate: date(g.targetDate), accountId: g.accountId, annualRateBp: g.annualRateBp,
        contributions: g.contributions.map((c) => ({ date: toIso(c.date), amountCents: c.amountCents, note: c.note })),
      })),
      payslips: payslips.map((p) => ({ accountId: p.accountId, periodMonth: p.periodMonth, netCents: p.netCents, grossCents: p.grossCents, employer: p.employer, transactionId: p.transactionId })),
      ignoredSubscriptions: dismissals.map((d) => d.key),
      // Noms et dates seulement : la clé publique n'a aucun intérêt hors de l'application.
      passkeys: passkeys.map((p) => ({ name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null })),
      reminder: reminder ? { enabled: reminder.enabled, weekday: reminder.weekday, hour: reminder.hour, timezone: reminder.timezone } : null,
      ...(audit ? { auditLog: audit.map((e) => ({ action: e.action, userId: e.userId, createdAt: e.createdAt.toISOString() })) } : {}),
    };
  }

  /**
   * Un membre (adulte ou enfant) supprime son propre compte : son profil, ses sessions, son rappel, ses appareils et ses comptes
   * personnels (avec leurs opérations). Les opérations saisies sur les comptes joints restent au foyer. Le propriétaire, lui,
   * supprime le foyer entier.
   */
  @Post("delete-me")
  @HttpCode(204)
  async deleteMe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(DeleteConfirmDto)) dto: DeleteConfirmDto, @Res({ passthrough: true }) res: FastifyReply) {
    if (user.role === "OWNER") throw new ConflictException("Le propriétaire ne peut pas supprimer seulement son compte : supprimez le foyer entier.");
    await this.auth.verifyPassword(user.userId, dto.password);
    await this.prisma.user.deleteMany({ where: { id: user.userId, householdId: user.householdId } });
    await this.audit.record(user.householdId, null, `privacy.member_deleted_self:${user.role}`);
    clearSession(res);
  }

  /** Le propriétaire efface le foyer entier : membres, comptes, opérations, objectifs, journal… tout part en cascade. */
  @Post("delete-household")
  @HttpCode(204)
  @Roles("OWNER")
  async deleteHousehold(@CurrentUser() user: AuthUser, @Body(new ZodPipe(DeleteConfirmDto)) dto: DeleteConfirmDto, @Res({ passthrough: true }) res: FastifyReply) {
    await this.auth.verifyPassword(user.userId, dto.password);
    await this.prisma.household.deleteMany({ where: { id: user.householdId } });
    clearSession(res);
  }
}
