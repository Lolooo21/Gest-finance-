import { Controller, Get, Module } from "@nestjs/common";
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
  imports: [PrismaModule, AuditModule, AuthModule, HouseholdModule],
  controllers: [HealthController],
})
export class AppModule {}
