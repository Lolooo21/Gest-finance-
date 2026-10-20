import { Controller, Get, UseGuards } from "@nestjs/common";
import { nextRateRevision } from "@gest-finance/finance-core";
import { AuthGuard } from "../common/auth.guard.js";
import { MarketService } from "./market.service.js";
import { currentPelRate, currentRegulatedRates } from "./regulated-rates.js";
import { SAVINGS_DISCLAIMER, SAVINGS_PRODUCTS } from "./savings-products.js";

/** Données publiques en lecture seule : réservées aux utilisateurs connectés, mais sans rapport avec un foyer. */
@Controller("market")
@UseGuards(AuthGuard)
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get()
  async get() {
    const now = new Date();
    return {
      regulated: { ...currentRegulatedRates(now), nextRevision: nextRateRevision(now), pel: currentPelRate(now) },
      indicators: await this.market.indicators(now),
      refreshEnabled: this.market.refreshEnabled,
      disclaimer: SAVINGS_DISCLAIMER,
    };
  }
}

@Controller("savings")
@UseGuards(AuthGuard)
export class SavingsController {
  @Get("products")
  products() {
    return { products: SAVINGS_PRODUCTS, disclaimer: SAVINGS_DISCLAIMER };
  }
}
