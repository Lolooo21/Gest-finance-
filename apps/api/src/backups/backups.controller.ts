import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard.js";
import { readBackupStatus } from "./backup-status.js";

/** État des sauvegardes (date, copie distante, échec) : aucune donnée du foyer, visible par tout membre connecté. */
@Controller("backups")
@UseGuards(AuthGuard)
export class BackupsController {
  @Get("status")
  status() {
    return readBackupStatus();
  }
}
