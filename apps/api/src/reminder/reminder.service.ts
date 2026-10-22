import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { dueSlot, type ReminderConfig } from "@gest-finance/finance-core";
import type { ReminderDto } from "@gest-finance/shared";
import type { ReminderSetting } from "@prisma/client";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService, SystemPrismaService } from "../prisma/prisma.service.js";
import { PushSender } from "../push/push.sender.js";

const cfg = (s: ReminderSetting): ReminderConfig => ({ weekday: s.weekday, hour: s.hour, timezone: s.timezone });

/** Le contenu d'une notification ne contient jamais de donnée financière. */
const NOTIFICATION = { title: "Gest-finance", body: "C'est l'heure de faire les comptes de la semaine.", url: "/?bilan=1" };

@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrismaService,
    private readonly sender: PushSender,
    private readonly audit: AuditService,
  ) {}

  /**
   * Planificateur interne : vérifie chaque minute les rappels dus. Idempotent (état en base),
   * donc sans danger en cas de redémarrage. Désactivé en test ou avec REMINDER_SCHEDULER=off.
   */
  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.REMINDER_SCHEDULER === "off") return;
    this.timer = setInterval(() => void this.runOnce(new Date()).catch(() => undefined), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async view(userId: string, now = new Date()) {
    const s = await this.prisma.reminderSetting.upsert({ where: { userId }, update: {}, create: { userId } });
    const subscribed = (await this.prisma.pushSubscription.count({ where: { userId } })) > 0;
    return {
      enabled: s.enabled, weekday: s.weekday, hour: s.hour, timezone: s.timezone,
      lastDoneAt: s.lastDoneAt?.toISOString() ?? null,
      due: s.enabled && dueSlot(now, cfg(s), s.since, s.lastDoneAt) !== null,
      pushConfigured: this.sender.publicKey !== null,
      subscribed,
    };
  }

  async update(userId: string, dto: ReminderDto, now = new Date()) {
    // `since` repart de maintenant : pas de rappel rétroactif pour un créneau déjà passé.
    await this.prisma.reminderSetting.upsert({
      where: { userId },
      update: { ...dto, since: now },
      create: { userId, ...dto, since: now },
    });
    return this.view(userId, now);
  }

  async markDone(userId: string, householdId: string, now = new Date()) {
    await this.prisma.reminderSetting.upsert({ where: { userId }, update: { lastDoneAt: now }, create: { userId, lastDoneAt: now } });
    await this.audit.record(householdId, userId, "review.done");
  }

  /** Envoie les notifications dues. Renvoie le nombre d'utilisateurs notifiés. */
  async runOnce(now: Date, sender: PushSender = this.sender): Promise<number> {
    if (!sender.publicKey) return 0;
    const settings = await this.system.reminderSetting.findMany({
      where: { enabled: true, user: { pushSubscriptions: { some: {} } } },
      include: { user: { include: { pushSubscriptions: true } } },
    });
    let notified = 0;
    for (const s of settings) {
      const slot = dueSlot(now, cfg(s), s.since, s.lastDoneAt);
      if (!slot || (s.lastReminderAt && s.lastReminderAt >= slot)) continue;
      let delivered = false;
      for (const sub of s.user.pushSubscriptions) {
        const result = await sender.send(sub, NOTIFICATION);
        if (result === "ok") delivered = true;
        if (result === "gone") await this.system.pushSubscription.deleteMany({ where: { id: sub.id } });
      }
      if (delivered) {
        await this.system.reminderSetting.update({ where: { userId: s.userId }, data: { lastReminderAt: now } });
        await this.audit.record(s.user.householdId, s.userId, "reminder.sent");
        notified++;
      }
    }
    return notified;
  }
}
