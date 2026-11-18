import "@fastify/multipart";
import { BadRequestException, Body, ConflictException, Controller, HttpCode, NotFoundException, PayloadTooLargeException, Post, Req, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { parsePayslip } from "@gest-finance/finance-core";
import { PayslipConfirmDto } from "@gest-finance/shared";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, Roles, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { toDate, toIso } from "../common/dates.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { extractScanImages, looksLikeJpeg, looksLikePng, ocrImages } from "./ocr.js";
import { hasUsableText, looksLikePdf, readPdfText } from "./pdf-text.js";

/** PDF numérique, PDF scanné ou photo : 10 Mo au plus (une photo de téléphone en fait souvent 3 à 6). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const OCR_WARNING = "Lu sur une image (scan ou photo) : vérifiez chaque montant, la reconnaissance de caractères peut se tromper.";

/** Même jour du mois suivant (ramené au dernier jour si besoin) : évite de compter deux fois le mois déjà saisi. */
function nextMonthSameDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m, Math.min(d, last))));
}

@Controller("payslips")
@UseGuards(AuthGuard)
export class PayslipController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lit la fiche de paie en mémoire et PROPOSE des valeurs. Rien n'est enregistré ni conservé : la validation humaine vient ensuite.
   * PDF numérique : texte du fichier. PDF scanné ou photo (JPEG, PNG) : reconnaissance de caractères locale (OCR).
   */
  @Post("parse")
  @HttpCode(200)
  @Roles("OWNER", "ADULT")
  async parse(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException("Envoyez le fichier en multipart/form-data");
    const part = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
    if (!part) throw new BadRequestException("Aucun fichier reçu");
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new PayloadTooLargeException("Fichier trop volumineux (10 Mo maximum)");
    }
    let text: string;
    let ocr = false;
    if (looksLikePdf(buffer)) {
      text = await readPdfText(buffer);
      if (!hasUsableText(text)) {
        const pages = await extractScanImages(buffer);
        if (pages.length === 0) {
          throw new UnprocessableEntityException("Ce PDF ne contient ni texte ni page scannée lisible. Prenez plutôt la fiche en photo (JPEG ou PNG).");
        }
        text = await ocrImages(pages);
        ocr = true;
      }
    } else if (looksLikeJpeg(buffer) || looksLikePng(buffer)) {
      text = await ocrImages([buffer]);
      ocr = true;
    } else {
      throw new BadRequestException("Envoyez un PDF ou une photo de la fiche de paie (JPEG ou PNG)");
    }
    if (ocr && !hasUsableText(text)) throw new UnprocessableEntityException("Aucun texte reconnu : envoyez une photo plus nette, bien éclairée, prise bien droite.");
    await this.audit.record(user.householdId, user.userId, ocr ? "payslip.parsed:ocr" : "payslip.parsed");
    const result = parsePayslip(text);
    return ocr ? { ...result, ocr, warnings: [OCR_WARNING, ...result.warnings] } : { ...result, ocr };
  }

  @Post("confirm")
  @Roles("OWNER", "ADULT")
  async confirm(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PayslipConfirmDto)) dto: PayslipConfirmDto) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: dto.accountId, householdId: user.householdId }, select: { id: true } });
    if (!account) throw new NotFoundException("Compte introuvable");

    if (!dto.force) {
      const duplicate = await this.prisma.payslipImport.findFirst({
        where: { householdId: user.householdId, accountId: dto.accountId, periodMonth: dto.periodMonth, netCents: dto.netToPayCents, transactionId: { not: null } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException("Cette fiche de paie semble déjà importée (même compte, période et montant).");
    }

    const result = await this.prisma.$householdTransaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: { householdId: user.householdId, accountId: dto.accountId, amountCents: dto.netToPayCents, date: toDate(dto.paymentDate), label: `Salaire ${dto.periodMonth}` },
      });
      await tx.payslipImport.create({
        data: {
          householdId: user.householdId, userId: user.userId, accountId: dto.accountId, periodMonth: dto.periodMonth,
          netCents: dto.netToPayCents, grossCents: dto.grossCents ?? null, employer: dto.employer ?? null, transactionId: transaction.id,
        },
      });
      const rule = dto.createRecurring
        ? await tx.recurringRule.create({
            data: {
              householdId: user.householdId, accountId: dto.accountId, label: dto.employer ? `Salaire ${dto.employer}` : "Salaire",
              amountCents: dto.netToPayCents, frequency: "MONTHLY", start: toDate(nextMonthSameDay(dto.paymentDate)),
            },
          })
        : null;
      return { transactionId: transaction.id, ruleId: rule?.id ?? null, recurringStart: rule ? toIso(rule.start) : null };
    });
    await this.audit.record(user.householdId, user.userId, "payslip.confirmed");
    return result;
  }
}
