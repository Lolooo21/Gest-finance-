# DONE — réalisé

## Jalon 1 — Socle et domaine financier
### `packages/finance-core/src/recurrence.ts`
- `occurrences(rule, from, to)` : renvoie les dates d'une règle récurrente (WEEKLY/MONTHLY/YEARLY) dans [from, to], bornes incluses, en respectant la date de fin. Pour MONTHLY/YEARLY, un jour 31 est ramené au dernier jour des mois plus courts (31 → 28/30).
- `addMonths(base, months)` (interne) : ajoute des mois en UTC avec ce plafonnement du jour.
- Types `Frequency`, `RecurringRule` (montants en centimes, positif = revenu, négatif = dépense).

### `packages/finance-core/src/resteAVivre.ts`
- `resteAVivre(from, to, rules, oneOffs)` : fonction pure qui calcule revenus − charges fixes − dépenses ponctuelles sur la période ; renvoie `incomeCents`, `fixedChargesCents`, `oneOffExpensesCents`, `remainingCents`. À rappeler à chaque nouvelle entrée/sortie.

### Tests — `packages/finance-core/src/finance-core.test.ts`
5 tests unitaires (hebdo, fin de mois, borne de fin, calcul du reste à vivre, recalcul après nouvelle sortie), couverture 100 %.

### Infra et documentation
- `infra/docker/compose.dev.yml` : Postgres 16 + Redis 7 en réseau interne, secret pour le mot de passe.
- `.github/workflows/ci.yml` : lint, typecheck, tests, audit, Gitleaks.
- `docs/threat-model.md` : STRIDE v0 ; `README.md`, `CLAUDE.md`, `TODO.md`.
