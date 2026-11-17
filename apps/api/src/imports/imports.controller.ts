import "@fastify/multipart";
import { BadRequestException, Body, Controller, HttpCode, NotFoundException, PayloadTooLargeException, Post, Query, Req, UnsupportedMediaTypeException, UseGuards } from "@nestjs/common";
import { importKeys, parseStatement, reconcile } from "@gest-finance/finance-core";
import { ImportConfirmDto, ImportPreviewQuery, MAX_IMPORT_LINES } from "@gest-finance/shared";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { CategoriesService } from "../categories/categories.service.js";
import { CategorizerService } from "../categories/categorizer.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";

export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;
/** Écart toléré entre la date bancaire et la date saisie à la main (ou celle d'une récurrence). */
const TOLERANCE_DAYS = 2;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const shift = (iso: string, days: number) => toIso(new Date(toDate(iso).getTime() + days * 86_400_000));

/** Les exports bancaires sont en UTF-8 ou en Windows-1252 (Latin-1) : on tente le premier, sinon le second. */
function decode(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/**
 * Import de relevés bancaires CSV ou OFX en deux temps : aperçu (rien n'est enregistré, le fichier n'est pas conservé),
 * puis validation des lignes cochées. Chaque ligne importée ou rapprochée garde une empreinte : réimporter le même relevé
 * ne crée aucun doublon.
 */
@Controller("imports")
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly categorizer: CategorizerService,
  ) {}

  @Post("preview")
  @HttpCode(200)
  @Roles("OWNER", "ADULT")
  async preview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ImportPreviewQuery)) q: ImportPreviewQuery, @Req() req: FastifyRequest) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: q.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");
    if (!req.isMultipart()) throw new BadRequestException("Envoyez le relevé en multipart/form-data");
    const part = await req.file({ limits: { fileSize: MAX_STATEMENT_BYTES, files: 1, fields: 0 } });
    if (!part) throw new BadRequestException("Aucun fichier reçu");
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new PayloadTooLargeException("Fichier trop volumineux (2 Mo maximum)");
    }
    if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
      throw new UnsupportedMediaTypeException("Les relevés PDF ne sont pas encore pris en charge : exportez vos opérations en CSV ou en OFX depuis l'espace client de votre banque.");
    }

    const parsed = parseStatement(decode(buffer));
    if (parsed.lines.length > MAX_IMPORT_LINES) throw new BadRequestException(`Relevé trop long : ${MAX_IMPORT_LINES} opérations maximum par import`);
    const keys = importKeys(parsed.lines).map(sha256);
    const dates = parsed.lines.map((l) => l.date).sort();
    const [existing, rules, suggest] = parsed.lines.length === 0
      ? [[], [], () => null]
      : await Promise.all([
          this.prisma.transaction.findMany({
            where: { householdId: user.householdId, accountId: account.id, date: { gte: toDate(shift(dates[0]!, -TOLERANCE_DAYS)), lte: toDate(shift(dates.at(-1)!, TOLERANCE_DAYS)) } },
            select: { id: true, date: true, amountCents: true, label: true, importHash: true },
          }),
          this.prisma.recurringRule.findMany({ where: { householdId: user.householdId, accountId: account.id } }),
          this.categorizer.load(user.householdId),
        ]);
    const lines = reconcile(
      parsed.lines.map((l, i) => ({ ...l, key: keys[i]! })),
      existing.map((t) => ({ id: t.id, date: toIso(t.date), amountCents: t.amountCents, label: t.label, importKey: t.importHash })),
      rules.map((r) => ({ id: r.id, label: r.label, amountCents: r.amountCents, frequency: r.frequency, start: toIso(r.start), ...(r.end ? { end: toIso(r.end) } : {}) })),
      TOLERANCE_DAYS,
    ).map((l) => {
      // Catégorie proposée pour les lignes qui seront créées (les opérations rapprochées gardent la leur).
      const suggestion = l.status === "NEW" || l.status === "RECURRING" ? suggest(l.label) : null;
      return {
        key: l.key, date: l.date, amountCents: l.amountCents, label: l.label, status: l.status,
        ...(l.match ? { match: l.match } : {}),
        ...(suggestion ? { suggestion: { categoryId: suggestion.categoryId, source: suggestion.source } } : {}),
      };
    });

    await this.audit.record(user.householdId, user.userId, "statement.previewed");
    const count = (s: string) => lines.filter((l) => l.status === s).length;
    return {
      format: parsed.format,
      warnings: parsed.warnings,
      skipped: parsed.skipped,
      summary: { NEW: count("NEW"), MATCHED: count("MATCHED"), RECURRING: count("RECURRING"), ALREADY_IMPORTED: count("ALREADY_IMPORTED") },
      lines,
    };
  }

  /** Crée les lignes « CREATE » et marque comme rapprochées les opérations « LINK ». Les empreintes déjà présentes sont ignorées. */
  @Post("confirm")
  @Roles("OWNER", "ADULT")
  async confirm(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ImportConfirmDto)) dto: ImportConfirmDto) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: dto.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");
    const unique = [...new Map(dto.lines.map((l) => [l.key, l])).values()];
    for (const id of new Set(unique.flatMap((l) => (l.categoryId ? [l.categoryId] : [])))) await this.categories.assertCategory(user.householdId, id);
    // Catégorie absente : proposition automatique ; null : sans catégorie ; choisie : apprise après l'import.
    const suggest = unique.some((l) => l.action === "CREATE" && l.categoryId === undefined) ? await this.categorizer.load(user.householdId) : null;
    const categoryOf = (l: (typeof unique)[number]) => (l.categoryId === undefined ? (suggest?.(l.label)?.categoryId ?? null) : l.categoryId);

    const result = await this.prisma.$householdTransaction(async (tx) => {
      const known = new Set(
        (await tx.transaction.findMany({ where: { accountId: account.id, importHash: { in: unique.map((l) => l.key) } }, select: { importHash: true } }))
          .map((t) => t.importHash),
      );
      const fresh = unique.filter((l) => !known.has(l.key));
      let linked = 0;
      for (const l of fresh.filter((x) => x.action === "LINK")) {
        // Seule une opération saisie à la main, du même compte et du même foyer, peut être rapprochée.
        const { count } = await tx.transaction.updateMany({
          where: { id: l.transactionId, householdId: user.householdId, accountId: account.id, importHash: null },
          data: { importHash: l.key },
        });
        if (!count) throw new BadRequestException(`Opération à rapprocher introuvable ou déjà rapprochée : « ${l.label} »`);
        linked += count;
      }
      const { count: created } = await tx.transaction.createMany({
        data: fresh.filter((x) => x.action === "CREATE").map((l) => ({
          householdId: user.householdId, accountId: account.id, amountCents: l.amountCents, date: toDate(l.date), label: l.label, importHash: l.key, categoryId: categoryOf(l),
        })),
        skipDuplicates: true,
      });
      return { created, linked, skipped: dto.lines.length - created - linked };
    });
    await this.categorizer.learn(user.householdId, unique.flatMap((l) => (l.action === "CREATE" && l.categoryId ? [{ label: l.label, categoryId: l.categoryId }] : [])));
    await this.audit.record(user.householdId, user.userId, `statement.imported:${result.created}+${result.linked}`);
    return result;
  }
}
