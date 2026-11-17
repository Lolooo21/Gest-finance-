import { Controller, Get, Module } from "@nestjs/common";
import { ImportsController } from "./imports/imports.controller.js";
import { CategoriesController } from "./categories/categories.controller.js";
import { CategoriesService } from "./categories/categories.service.js";
import { CategorizerService } from "./categories/categorizer.service.js";
import { SubscriptionsController } from "./subscriptions/subscriptions.controller.js";
import { SubscriptionsService } from "./subscriptions/subscriptions.service.js";
import { ForecastController } from "./forecast/forecast.controller.js";
import { GoalsController } from "./goals/goals.controller.js";
import { GoalsService } from "./goals/goals.service.js";
import { SavingsGoalsController } from "./goals/savings-goals.controller.js";
import { AccountsController } from "./accounts/accounts.controller.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import { RecurringController } from "./recurring/recurring.controller.js";
import { SummaryController } from "./summary/summary.controller.js";
import { TransactionsController } from "./transactions/transactions.controller.js";
import { MarketController, SavingsController } from "./market/market.controller.js";
import { MarketService } from "./market/market.service.js";
import { PayslipController } from "./payslip/payslip.controller.js";
import { PushSender, WebPushSender } from "./push/push.sender.js";
import { ReminderController } from "./reminder/reminder.controller.js";
import { ReminderService } from "./reminder/reminder.service.js";
import { ReviewController } from "./review/review.controller.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HouseholdModule } from "./household/household.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok" };
  }
}

@Module({
  imports: [PrismaModule, CryptoModule, AuditModule, AuthModule, HouseholdModule],
  controllers: [HealthController, AccountsController, TransactionsController, RecurringController, SummaryController, ReminderController, ReviewController, PayslipController, MarketController, SavingsController, ForecastController, GoalsController, SavingsGoalsController, CategoriesController, ImportsController, SubscriptionsController],
  providers: [ReminderService, MarketService, GoalsService, CategoriesService, CategorizerService, SubscriptionsService, { provide: PushSender, useClass: WebPushSender }],
})
export class AppModule {}
