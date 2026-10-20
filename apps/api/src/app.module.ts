import { Controller, Get, Module } from "@nestjs/common";
import { AccountsController } from "./accounts/accounts.controller.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import { RecurringController } from "./recurring/recurring.controller.js";
import { SummaryController } from "./summary/summary.controller.js";
import { TransactionsController } from "./transactions/transactions.controller.js";
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
  controllers: [HealthController, AccountsController, TransactionsController, RecurringController, SummaryController],
})
export class AppModule {}
