import { Module } from "@nestjs/common";
import { HouseholdController } from "./household.controller.js";

@Module({ controllers: [HouseholdController] })
export class HouseholdModule {}
