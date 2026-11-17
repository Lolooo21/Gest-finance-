import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateBackupStatus, readBackupStatus } from "../src/backups/backup-status.js";
import { get, owner, post, resetDb, sessionCookies, startApp } from "./helpers.js";

const NOW = new Date("2026-11-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString().slice(0, 19) + "Z";

describe("jugement de l'état des sauvegardes", () => {
  it("tout va bien : sauvegarde de la nuit, copie distante envoyée", () => {
    expect(evaluateBackupStatus({ at: hoursAgo(8), sizeBytes: 52_000, remote: "ok" }, { at: hoursAgo(8), exitCode: 0 }, NOW)).toEqual({
      configured: true, level: "ok", problems: [], lastSuccessAt: hoursAgo(8), ageHours: 8, sizeBytes: 52_000, remote: "ok", lastFailureAt: null,
    });
  });

  it("alerte quand la sauvegarde de la nuit manque, puis gravement après deux nuits", () => {
    expect(evaluateBackupStatus({ at: hoursAgo(30), sizeBytes: 1, remote: "ok" }, null, NOW)).toMatchObject({ level: "warning", problems: [expect.stringMatching(/il y a 30 h/)] });
    expect(evaluateBackupStatus({ at: hoursAgo(75), sizeBytes: 1, remote: "ok" }, null, NOW)).toMatchObject({ level: "critical", problems: [expect.stringMatching(/il y a 3 jours/)] });
    expect(evaluateBackupStatus(null, null, NOW)).toMatchObject({ level: "critical", problems: ["Aucune sauvegarde réussie pour l'instant."], lastSuccessAt: null, ageHours: null });
  });

  it("signale une copie distante absente ou en échec, et une tentative ratée après la dernière réussite", () => {
    expect(evaluateBackupStatus({ at: hoursAgo(5), sizeBytes: 1, remote: "none" }, null, NOW)).toMatchObject({ level: "warning", problems: [expect.stringMatching(/Aucun stockage distant/)] });
    expect(evaluateBackupStatus({ at: hoursAgo(5), sizeBytes: 1, remote: "failed" }, null, NOW)).toMatchObject({ level: "critical", problems: [expect.stringMatching(/envoi vers le stockage distant a échoué/)] });
    const failed = evaluateBackupStatus({ at: hoursAgo(20), sizeBytes: 1, remote: "ok" }, { at: hoursAgo(2), exitCode: 1 }, NOW);
    expect(failed).toMatchObject({ level: "warning", lastFailureAt: hoursAgo(2), problems: [expect.stringMatching(/dernière tentative/)] });
    // Une tentative ratée AVANT la dernière réussite n'est plus d'actualité ; les problèmes graves passent en premier.
    expect(evaluateBackupStatus({ at: hoursAgo(2), sizeBytes: 1, remote: "ok" }, { at: hoursAgo(20), exitCode: 1 }, NOW).lastFailureAt).toBeNull();
    expect(evaluateBackupStatus({ at: hoursAgo(60), sizeBytes: 1, remote: "none" }, { at: hoursAgo(1), exitCode: 3 }, NOW).problems).toHaveLength(3);
    expect(evaluateBackupStatus({ at: hoursAgo(60), sizeBytes: 1, remote: "none" }, null, NOW).problems[0]).toMatch(/jours/);
  });
});

describe("lecture des fichiers d'état", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "backup-status-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("n'est pas configurée sans dossier, et tolère des fichiers absents ou corrompus", () => {
    expect(readBackupStatus("", NOW)).toMatchObject({ configured: false, level: "unknown" });
    expect(readBackupStatus(dir, NOW)).toMatchObject({ configured: true, level: "critical", lastSuccessAt: null });
    writeFileSync(join(dir, "last-success.json"), "{pas du json");
    writeFileSync(join(dir, "last-attempt.json"), JSON.stringify({ at: "hier", exitCode: 0 }));
    expect(readBackupStatus(dir, NOW)).toMatchObject({ level: "critical", lastSuccessAt: null, lastFailureAt: null });
    writeFileSync(join(dir, "last-success.json"), JSON.stringify({ at: hoursAgo(3), sizeBytes: 9, remote: "ailleurs" }));
    expect(readBackupStatus(dir, NOW).lastSuccessAt).toBeNull();
    writeFileSync(join(dir, "last-success.json"), JSON.stringify({ at: hoursAgo(3), sizeBytes: 9, remote: "ok" }));
    expect(readBackupStatus(dir, NOW)).toMatchObject({ level: "ok", ageHours: 3, sizeBytes: 9 });
  });
});

describe("GET /backups/status", () => {
  let app: NestFastifyApplication;
  let dir: string;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDb(app);
    dir = mkdtempSync(join(tmpdir(), "backup-status-"));
  });
  afterEach(() => {
    process.env.BACKUP_STATUS_DIR = "";
    rmSync(dir, { recursive: true, force: true });
  });

  it("exige une session, puis renvoie l'état lu sur le volume, à tous les membres", async () => {
    expect((await get(app, "/backups/status")).statusCode).toBe(401);
    const c = { access: sessionCookies(await post(app, "/auth/register", owner())).access! };
    expect((await get(app, "/backups/status", c)).json()).toMatchObject({ configured: false, level: "unknown" });

    process.env.BACKUP_STATUS_DIR = dir;
    const at = new Date(Date.now() - 4 * 3_600_000).toISOString();
    writeFileSync(join(dir, "last-success.json"), JSON.stringify({ at, sizeBytes: 48_213, remote: "ok" }));
    writeFileSync(join(dir, "last-attempt.json"), JSON.stringify({ at, exitCode: 0 }));
    await post(app, "/household/members", { email: "enfant@example.com", displayName: "Enfant", password: "correct-horse-battery", role: "CHILD" }, c);
    const child = { access: sessionCookies(await post(app, "/auth/login", { email: "enfant@example.com", password: "correct-horse-battery" })).access! };
    for (const who of [c, child]) {
      expect((await get(app, "/backups/status", who)).json()).toMatchObject({ configured: true, level: "ok", lastSuccessAt: at, ageHours: 4, sizeBytes: 48_213, remote: "ok", problems: [] });
    }
  });
});
