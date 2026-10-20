import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { PushSubscriptionDto, PushUnsubscribeDto, ReminderDto } from "@gest-finance/shared";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PushSender, isAllowedPushEndpoint } from "../push/push.sender.js";
import { ReminderService } from "./reminder.service.js";

/** Le rappel est personnel : tous les rôles, y compris CHILD, gèrent le leur. */
@Controller()
@UseGuards(AuthGuard)
export class ReminderController {
  constructor(
    private readonly reminders: ReminderService,
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
  ) {}

  @Get("reminder")
  get(@CurrentUser() user: AuthUser) {
    return this.reminders.view(user.userId);
  }

  @Put("reminder")
  put(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ReminderDto)) dto: ReminderDto) {
    return this.reminders.update(user.userId, dto);
  }

  @Post("reminder/done")
  @HttpCode(200)
  async done(@CurrentUser() user: AuthUser) {
    await this.reminders.markDone(user.userId, user.householdId);
    return this.reminders.view(user.userId);
  }

  @Get("push/config")
  config() {
    return { publicKey: this.sender.publicKey };
  }

  @Post("push/subscriptions")
  async subscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PushSubscriptionDto)) dto: PushSubscriptionDto) {
    if (!isAllowedPushEndpoint(dto.endpoint)) throw new BadRequestException("Service de notification non reconnu");
    // Un endpoint appartient à un seul utilisateur : il est réattribué s'il change de compte sur le même appareil.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: { userId: user.userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      create: { userId: user.userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
    return { ok: true };
  }

  @Delete("push/subscriptions")
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PushUnsubscribeDto)) dto: PushUnsubscribeDto) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint: dto.endpoint, userId: user.userId } });
  }
}
