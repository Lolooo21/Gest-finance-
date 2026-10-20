import "reflect-metadata";
import { API_ROUTE_PREFIXES } from "@gest-finance/shared";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";

type Controller = { prototype: Record<string, unknown> };

/** Garde-fou : un contrôleur dont le préfixe n'est pas dans la liste partagée serait injoignable depuis le front en développement (404). */
describe("préfixes de routes de l'API", () => {
  const controllers: Controller[] = Reflect.getMetadata("controllers", AppModule);
  // Les modules importés déclarent aussi des contrôleurs (auth, foyer).
  const imported: Controller[] = (Reflect.getMetadata("imports", AppModule) as object[]).flatMap((m) => Reflect.getMetadata("controllers", m) ?? []);

  /** Premier segment de chaque route : celui du contrôleur, ou celui de ses méthodes si le contrôleur n'a pas de préfixe. */
  const firstSegments = (controller: Controller): string[] => {
    const base = String(Reflect.getMetadata("path", controller)).replace(/^\//, "");
    if (base) return [`/${base.split("/")[0]}`];
    return Object.getOwnPropertyNames(controller.prototype)
      .map((name) => Reflect.getMetadata("path", controller.prototype[name] as object))
      .map((path) => String(path ?? "").replace(/^\//, ""))
      .filter((path) => path !== "")
      .map((path) => `/${path.split("/")[0]}`);
  };

  it("expose chaque route via un préfixe connu du proxy du front", () => {
    const prefixes = [...controllers, ...imported].flatMap(firstSegments);
    expect(prefixes.length).toBeGreaterThanOrEqual(10);
    for (const prefix of prefixes) expect(API_ROUTE_PREFIXES, `préfixe manquant : ${prefix}`).toContain(prefix);
  });

  it("inclut les routes des fiches de paie et du rappel", () => {
    for (const p of ["/payslips", "/reminder", "/review", "/push"]) expect(API_ROUTE_PREFIXES).toContain(p);
  });
});
