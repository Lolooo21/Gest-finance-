import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { fetchIndicator } from "./fetch-indicator.js";
import { INDICATORS } from "./indicators.js";

const REFRESH_AFTER_MS = 24 * 3_600_000;
/** Au-delà, une donnée dont le rafraîchissement échoue est signalée comme ancienne. */
const STALE_AFTER_MS = 4 * 24 * 3_600_000;

export type IndicatorStatus = "ok" | "stale" | "unavailable";

export interface IndicatorView {
  key: string;
  label: string;
  explanation: string;
  source: string;
  sourceUrl: string;
  valueBp: number | null;
  observedAt: string | null;
  fetchedAt: string | null;
  status: IndicatorStatus;
}

export interface RefreshReport {
  ok: string[];
  failed: { key: string; reason: string }[];
}

@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Marché");
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  /** Appels sortants désactivables (`MARKET_REFRESH=off`) ; jamais en test. Aucune donnée du foyer n'est envoyée. */
  get refreshEnabled() {
    return process.env.MARKET_REFRESH !== "off" && process.env.NODE_ENV !== "test";
  }

  onModuleInit() {
    if (!this.refreshEnabled) return;
    void this.refreshIfDue().catch((e) => this.log.warn(`Rafraîchissement impossible : ${(e as Error).message}`));
    this.timer = setInterval(() => void this.refreshIfDue().catch(() => undefined), 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Ne contacte les sources que si une donnée manque ou a plus de 24 h. */
  async refreshIfDue(now = new Date()): Promise<RefreshReport | null> {
    const latest = await this.prisma.marketSnapshot.groupBy({ by: ["key"], _max: { fetchedAt: true } });
    const byKey = new Map(latest.map((l) => [l.key, l._max.fetchedAt]));
    const due = INDICATORS.some((i) => {
      const at = byKey.get(i.key);
      return !at || now.getTime() - at.getTime() > REFRESH_AFTER_MS;
    });
    return due ? this.refresh(now) : null;
  }

  async refresh(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<RefreshReport> {
    const report: RefreshReport = { ok: [], failed: [] };
    for (const indicator of INDICATORS) {
      try {
        const { period, valueBp } = await fetchIndicator(indicator, fetchImpl);
        await this.prisma.marketSnapshot.upsert({
          where: { key_observedAt: { key: indicator.key, observedAt: period } },
          update: { valueBp, fetchedAt: now },
          create: { key: indicator.key, valueBp, observedAt: period, fetchedAt: now, source: indicator.source, sourceUrl: indicator.sourceUrl },
        });
        report.ok.push(indicator.key);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "erreur inconnue";
        report.failed.push({ key: indicator.key, reason });
        this.log.warn(`${indicator.key} : ${reason}`);
      }
    }
    return report;
  }

  /** Dernière valeur connue de chaque indicateur, avec son état. */
  async indicators(now = new Date()): Promise<IndicatorView[]> {
    const rows = await this.prisma.marketSnapshot.findMany({ orderBy: [{ observedAt: "desc" }, { fetchedAt: "desc" }] });
    return INDICATORS.map((i) => {
      const row = rows.find((r) => r.key === i.key);
      const status: IndicatorStatus = !row ? "unavailable" : now.getTime() - row.fetchedAt.getTime() > STALE_AFTER_MS ? "stale" : "ok";
      return {
        key: i.key, label: i.label, explanation: i.explanation, source: i.source, sourceUrl: i.sourceUrl,
        valueBp: row?.valueBp ?? null, observedAt: row?.observedAt ?? null, fetchedAt: row?.fetchedAt.toISOString() ?? null, status,
      };
    });
  }
}
