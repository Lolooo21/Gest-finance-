import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Dernière sauvegarde réussie, écrite par `infra/backup/backup.sh` (fichier `last-success.json`). */
export interface BackupSuccess {
  at: string;
  sizeBytes: number;
  remote: "ok" | "none" | "failed";
}

/** Dernière tentative, réussie ou non (fichier `last-attempt.json`). */
export interface BackupAttempt {
  at: string;
  exitCode: number;
}

export type BackupLevel = "ok" | "warning" | "critical" | "unknown";

export interface BackupStatus {
  /** Faux hors production (aucun dossier d'état monté) : l'application n'affiche rien. */
  configured: boolean;
  level: BackupLevel;
  /** Explications à afficher, de la plus grave à la moins grave (vide si tout va bien). */
  problems: string[];
  lastSuccessAt: string | null;
  ageHours: number | null;
  sizeBytes: number | null;
  remote: BackupSuccess["remote"] | null;
  lastFailureAt: string | null;
}

/** La sauvegarde est quotidienne (03:30 UTC) : alerte après 26 h, alerte grave après 50 h (deux nuits manquées). */
export const WARNING_HOURS = 26;
export const CRITICAL_HOURS = 50;

/** Juge l'état des sauvegardes à l'instant `now`. Fonction pure. */
export function evaluateBackupStatus(success: BackupSuccess | null, attempt: BackupAttempt | null, now: Date): BackupStatus {
  const ageHours = success ? Math.max(0, Math.floor((now.getTime() - Date.parse(success.at)) / 3_600_000)) : null;
  const lastFailureAt = attempt && attempt.exitCode !== 0 && (!success || attempt.at > success.at) ? attempt.at : null;
  const critical: string[] = [];
  const warning: string[] = [];
  if (!success) critical.push("Aucune sauvegarde réussie pour l'instant.");
  else if (ageHours! >= CRITICAL_HOURS) critical.push(`Dernière sauvegarde réussie il y a ${Math.floor(ageHours! / 24)} jours.`);
  else if (ageHours! >= WARNING_HOURS) warning.push(`Dernière sauvegarde réussie il y a ${ageHours} h : celle de cette nuit manque.`);
  if (lastFailureAt) warning.push("La dernière tentative de sauvegarde a échoué : consultez les journaux du conteneur « backup ».");
  if (success?.remote === "failed") critical.push("L'envoi vers le stockage distant a échoué : la sauvegarde n'existe que sur le serveur.");
  if (success?.remote === "none") warning.push("Aucun stockage distant configuré : une panne du serveur emporterait aussi les sauvegardes.");
  return {
    configured: true,
    level: critical.length ? "critical" : warning.length ? "warning" : "ok",
    problems: [...critical, ...warning],
    lastSuccessAt: success?.at ?? null,
    ageHours,
    sizeBytes: success?.sizeBytes ?? null,
    remote: success?.remote ?? null,
    lastFailureAt,
  };
}

const NOT_CONFIGURED: BackupStatus = {
  configured: false, level: "unknown", problems: [], lastSuccessAt: null, ageHours: null, sizeBytes: null, remote: null, lastFailureAt: null,
};

/** Lit un fichier d'état ; absent ou illisible = null (jamais d'exception jusqu'au client). */
function readJson<T>(dir: string, file: string, valid: (v: unknown) => v is T): T | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isSuccess = (v: unknown): v is BackupSuccess =>
  typeof v === "object" && v !== null && isIso((v as BackupSuccess).at) && Number.isFinite((v as BackupSuccess).sizeBytes)
  && ["ok", "none", "failed"].includes((v as BackupSuccess).remote);
const isAttempt = (v: unknown): v is BackupAttempt =>
  typeof v === "object" && v !== null && isIso((v as BackupAttempt).at) && Number.isInteger((v as BackupAttempt).exitCode);

/** État des sauvegardes lu dans `BACKUP_STATUS_DIR` (volume en lecture seule) ; non configuré hors production. */
export function readBackupStatus(dir = process.env.BACKUP_STATUS_DIR, now = new Date()): BackupStatus {
  if (!dir) return NOT_CONFIGURED;
  return evaluateBackupStatus(readJson(dir, "last-success.json", isSuccess), readJson(dir, "last-attempt.json", isAttempt), now);
}
