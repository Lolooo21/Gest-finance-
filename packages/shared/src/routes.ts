/**
 * Préfixes de routes servis par l'API. Le proxy de développement du front (et la liste de refus du service worker)
 * s'appuient sur cette liste : tout nouveau contrôleur doit y figurer, un test de l'API le vérifie.
 */
export const API_ROUTE_PREFIXES = [
  "/auth", "/household", "/accounts", "/transactions", "/recurring-rules", "/summary",
  "/reminder", "/push", "/review", "/payslips", "/market", "/savings", "/forecast", "/goals", "/health",
] as const;
