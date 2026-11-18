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

## Jalon 2 — Auth et foyer (`apps/api`, `packages/shared`)
### `packages/shared/src/index.ts`
- Schémas Zod partagés : `RegisterDto`, `LoginDto`, `TotpCodeDto`, `AddMemberDto`, `Role` (OWNER/ADULT/CHILD). Mot de passe ≥ 12 caractères, e-mail normalisé en minuscules.

### `apps/api/src/auth/auth.service.ts`
- `register(dto)` : crée le foyer et son propriétaire (hash Argon2id), journalise, ouvre une session.
- `login(dto)` : même erreur et même coût pour compte inconnu ou mauvais mot de passe ; exige le code TOTP s'il est activé ; verrouille 15 min après 5 échecs.
- `refresh(token)` : rotation du refresh token (stocké hashé SHA-256) ; la réutilisation d'un token déjà révoqué révoque toutes les sessions de l'utilisateur.
- `logout(token)` : révoque le refresh token.
- `setupTotp(userId)` / `enableTotp(userId, code)` : génère le secret puis active le 2FA après vérification d'un code.
- `hashPassword(password)` : Argon2id, réutilisé pour l'ajout de membres.

### `apps/api/src/auth/auth.controller.ts`
- `POST /auth/register|login|refresh|logout|2fa/setup|2fa/enable`. Cookies `access` (15 min) et `refresh` (14 j, chemin `/auth`) HttpOnly, SameSite=Strict, Secure en production.

### `apps/api/src/common/`
- `AuthGuard` : vérifie le JWT du cookie, applique `@Roles(...)`, le `householdId` vient toujours du jeton. `CurrentUser`, `ZodPipe` (validation d'entrée).

### `apps/api/src/household/household.controller.ts`
- `GET /household/members` (tous rôles), `POST /household/members` et `GET /household/audit` (OWNER seulement). Toutes les requêtes sont filtrées par le foyer du jeton.

### `apps/api/src/audit/audit.service.ts`
- `record(householdId, userId, action)` : journal d'actions sans donnée financière ni secret.

### `apps/api/src/app.ts`
- `createApp()` : Fastify, Helmet (CSP stricte), cookies, rate limiting (100 req/min par défaut).

### Tests — `apps/api/test/*.int.test.ts` (13 tests, Postgres réel)
Hash Argon2id et cookies, validation d'entrée, non-énumération des comptes, verrouillage, rotation/réutilisation du refresh token, déconnexion, 2FA, accès sans jeton ou jeton falsifié, rôles, isolation entre foyers (IDOR), journal sans secret, rate limiting 429, en-têtes de sécurité.

### Infra
- Schéma Prisma + migration `init` (Household, User, RefreshToken, AuditLog) ; CI avec service Postgres, `prisma generate` et `migrate deploy`.

## Jalon 3 — Comptes, opérations, récurrences et front PWA
### API (`apps/api/src`)
- `crypto/crypto.service.ts` — `CryptoService.encrypt/decrypt` : AES-256-GCM avec IV aléatoire, clé `FIELD_ENCRYPTION_KEY` (32 octets) ; l'altération des données est détectée.
- `accounts/accounts.controller.ts` — `GET /accounts` (solde courant = solde initial + opérations, IBAN masqué `FR76••••0189`), `POST /accounts` (IBAN chiffré avant stockage), `DELETE /accounts/:id`.
- `transactions/transactions.controller.ts` — `GET /transactions`, `POST /transactions` (vérifie que le compte appartient au foyer), `DELETE /transactions/:id`. Montants en centimes signés.
- `recurring/recurring.controller.ts` — `GET/POST/DELETE /recurring-rules` (hebdo, mensuel, annuel, date de fin optionnelle).
- `summary/summary.controller.ts` — `GET /summary?from&to` : appelle `resteAVivre()` de `finance-core` sur les règles et opérations du foyer ; recalculé à chaque lecture.
- Écriture réservée à OWNER/ADULT, lecture pour tous (CHILD en lecture seule). Toutes les requêtes sont filtrées par le foyer du jeton.
- Script `pnpm dev` (API, avec `--env-file=.env` et rechargement automatique).
- Schémas Zod partagés : `AccountDto`, `TransactionDto`, `RecurringRuleDto`, `SummaryQuery`.
- Migration Prisma `comptes_transactions` (BankAccount, Transaction, RecurringRule).

### Front (`apps/web/src`)
- `api.ts` — `api()` : appel same-origin, renouvelle la session sur 401 puis rejoue une fois ; `ApiError`.
- `money.ts` — `parseEuros()` (saisie « 12,50 » → centimes, rejette les valeurs invalides), `formatCents()`, `monthRange()`, `todayIso()`.
- `privacy.tsx` — `PrivacyProvider`, `Money` : mode confidentialité (montants masqués), mémorisé sur l'appareil.
- `pages/AuthPage.tsx` — inscription et connexion (champ code 2FA).
- `pages/Dashboard.tsx` — reste à vivre du mois, comptes, formulaire d'entrée/sortie ponctuelle ou récurrente, récurrences, dernières opérations, suppressions.
- `App.tsx` — sonde de session (`/household/members`), écran de connexion ou tableau de bord.
- PWA : manifeste, service worker (jamais de cache des appels API), proxy Vite same-origin pour que les cookies fonctionnent.

### Tests
- API : 25 tests (chiffrement IBAN en base, IDOR comptes/opérations/résumé, enfant en lecture seule, recalcul du reste à vivre après chaque ajout, validation des périodes).
- Front : 16 tests (saisie en euros, connexion, mode confidentialité, envoi d'une sortie en centimes négatifs, montant invalide sans appel API).
- Vérification manuelle de bout en bout via le proxy Vite : inscription, compte, règle, résumé, refresh.

## Jalon 4 — Modification, 2FA dans l'interface, solde avec récurrences
### API
- `PATCH /accounts/:id`, `PATCH /transactions/:id`, `PATCH /recurring-rules/:id` : modifications partielles (schémas `AccountPatch`, `TransactionPatch`, `RecurringRulePatch`, au moins un champ), filtrées par foyer (404 sinon), réservées à OWNER/ADULT, journalisées. Pour une règle, la fin ne peut pas précéder le début ; `end: null` supprime la fin.
- `AccountsController.list` : le solde courant inclut maintenant les occurrences des règles récurrentes déjà échues jusqu'à aujourd'hui (via `occurrences()` de `finance-core`) ; les occurrences futures sont ignorées.

### Front
- `Dashboard.tsx` : bouton ✎ sur comptes, opérations et récurrences ; composant `EditForm` (modification en ligne, montant en euros, sens entrée/sortie conservé) ; composant `TwoFactor` (démarrage du 2FA, affichage de la clé secrète, saisie du code de validation).
- `money.ts` : `centsToInput()` préremplit un montant (1250 → « 12,50 »).

### Tests
- API : 28 tests (+3 : modification avec recalcul du reste à vivre, refus inter-foyers/vides/invalides/enfant, solde avec occurrences échues et non futures).
- Front : 19 tests (+3 : modification d'une opération en centimes, activation du 2FA, `centsToInput`).

### Documentation
- `README.md` : schéma de la base (Mermaid), explication des entités, tableau des fonctionnalités ; règle de mise à jour à chaque itération ajoutée à `CLAUDE.md`.

## Jalon 5 — Rappel hebdomadaire et bilan de la semaine
### `packages/finance-core/src/reminder.ts`
- `latestSlot(now, {weekday, hour, timezone})` : dernier créneau (≤ maintenant) où tombent ce jour de semaine et cette heure dans le fuseau, en gérant le changement d'heure été/hiver.
- `dueSlot(now, cfg, since, lastDoneAt)` : renvoie le créneau si le bilan est dû (créneau postérieur à l'activation et au dernier bilan fait), sinon `null`.
- Tests : 8 (heure d'hiver et d'été, jour même avant/après l'heure, passage à l'heure d'été, autre fuseau, règles de `since` et `lastDoneAt`).

### API
- `reminder/reminder.service.ts` — `view()` (réglages + `due` + abonnement), `update()` (repart de maintenant : pas de rappel rétroactif), `markDone()`, `runOnce(now, sender)` (envoie les notifications dues, une seule fois par créneau, supprime les abonnements expirés, ne marque pas le créneau si l'envoi échoue) et planificateur interne (chaque minute, désactivé en test ou avec `REMINDER_SCHEDULER=off`).
- `reminder/reminder.controller.ts` — `GET/PUT /reminder`, `POST /reminder/done`, `GET /push/config`, `POST/DELETE /push/subscriptions`. Réglages personnels, ouverts à tous les rôles, y compris CHILD.
- `push/push.sender.ts` — `PushSender` (abstrait), `WebPushSender` (clés VAPID, désactivé sans clés), `isAllowedPushEndpoint()` : liste blanche anti-SSRF (https, hôtes FCM, Mozilla, Windows, Apple, sans identifiants ni port).
- `review/review.controller.ts` — `GET /review/weekly?to=` : 7 jours se terminant à `to`, totaux d'entrées et sorties (opérations + récurrences échues), échéances des 7 jours suivants, reste à vivre du mois ; filtré par foyer.
- Migration `rappel_hebdo` (ReminderSetting, PushSubscription).

### Front
- `pages/Weekly.tsx` — `WeeklyReviewPanel` (bannière quand dû, bilan, bouton « J'ai fait mes comptes », ouverture auto avec `?bilan=1`), `ReminderSettings` (jour, heure, activation des notifications sur l'appareil).
- `push.ts` — `enablePush()` (permission, abonnement, enregistrement), `urlBase64ToUint8Array()`.
- `public/push-sw.js` — affichage de la notification et ouverture du bilan au clic, importé par le service worker.

### Tests
- API : 40 tests (+12 : réglages et validation, pas de rappel rétroactif, bilan fait, enfant, anti-SSRF, isolation des abonnements, notification unique par créneau, contenu sans donnée financière, abonnement expiré, échec d'envoi, absence de clés, bilan de la semaine et isolation par foyer).
- Front : 22 tests (+3). Production : build PWA vérifié (le service worker importe `push-sw.js`).
- Non vérifié : réception réelle d'une notification sur un navigateur ou un téléphone (nécessite des clés VAPID et un HTTPS ou localhost).

## Jalon 6 — Lecture des fiches de paie (PDF numérique)
### `packages/finance-core/src/payslip.ts`
- `parsePayslip(text)` : extrait net à payer (priorité : net payé, net après impôt, net à payer avant impôt, net à payer, net versé), brut, période AAAA-MM (« Période du … au … », « mois de février 2026 », « 07/2026 »), employeur ; calcule un indice de fiabilité (0 à 1) et des avertissements ; ne devine jamais (champ introuvable = `null`).
- `parseAmountCents(raw)` : « 2 345,67 », « 1.234,50 », « 1,234.50 » → centimes ; `null` si le format est inattendu.
- Tests : 19 (trois mises en page, formats de montants, absence de données, incohérences net/brut, période invalide).

### API (`apps/api/src/payslip/`)
- `pdf-text.ts` — `extractPdfText()` : lit le texte en mémoire avec pdfjs (sans `eval`, sans polices système, 5 pages maximum) ; refuse un non-PDF (400), un PDF corrompu (400) et un scan sans texte (422, message OCR) ; `looksLikePdf()` vérifie la signature.
- `payslip.controller.ts` — `POST /payslips/parse` (multipart, 5 Mo, OWNER/ADULT) : renvoie les valeurs proposées, n'enregistre rien ; `POST /payslips/confirm` : crée le revenu « Salaire AAAA-MM » dans une transaction SQL avec `PayslipImport`, refuse un compte d'un autre foyer (404) et un doublon (409, contournable par `force`), crée si demandé une règle mensuelle démarrant le mois suivant (`nextMonthSameDay()`).
- `app.ts` : `@fastify/multipart` (5 Mo, 1 fichier, 0 champ) ; limitation dédiée de 10 imports/min par IP.
- Migration `fiches_de_paie` (`PayslipImport`) ; schéma partagé `PayslipConfirmDto`.

### Front
- `pages/Payslip.tsx` — `PayslipImport` : choix du PDF, valeurs préremplies et modifiables, fiabilité et avertissements, compte et date de versement, case récurrence, « Enregistrer quand même » sur doublon ; `api.ts` : `apiUpload()` (multipart avec renouvellement de session).

### Tests
- API : 49 tests (+9 : extraction depuis un vrai PDF généré, rien d'enregistré au parse, fichier non-PDF/corrompu/scan/non multipart, plus de 5 Mo, session et rôle enfant, limitation de débit, création du revenu et reste à vivre, audit sans montant, doublon/force/réimport après suppression, récurrence sans double comptage, IDOR et valeurs invalides).
- Front : 25 tests (+3 : préremplissage et validation, doublon avec force, scan refusé).
- Non vérifié : lecture de vraies fiches de paie (le parseur n'a été testé que sur des textes fictifs) ; à confronter à vos PDF.

## Correctif — Erreurs 500 invisibles (inscription en échec sur le PC)
- `apps/api/src/common/all-exceptions.filter.ts` — `AllExceptionsFilter` : journalise les erreurs inattendues (nom, code, dernière ligne du message = la cause, 6 lignes de pile) sans corps de requête, en-têtes, cookies ni valeurs SQL ; répond un message générique au client ; conserve le statut des erreurs client de Fastify (429, 413, 400) ; laisse les `HttpException` suivre leur chemin normal. Auparavant `logger: false` rendait ces erreurs muettes.
- `apps/api/src/prisma/prisma.service.ts` — `onModuleInit` vérifie au démarrage une table par modèle (user, bankAccount, transaction, recurringRule, reminderSetting, pushSubscription, payslipImport) : si l'une manque (P2021/P2022), l'API s'arrête en nommant le modèle et en indiquant « prisma migrate deploy puis prisma generate ». Vérifié sur une base à moitié migrée.
- `apps/api/src/app.ts` — logs `error`/`warn` activés hors test, filtre global enregistré.
- Tests (+5, API : 54) : cause journalisée sans valeurs sensibles, réponse générique, statut 429 conservé, HttpException inchangée, message de base non migrée. Vérifié à la main : démarrage sur une base vide → message explicite.
- `README.md` : section « Dépannage ».

## Correctif et ergonomie — 404 à l'import du PDF, messages clairs, boutons visibles
### Cause du 404
- Le proxy de développement (`apps/web/vite.config.ts`) ne connaissait pas `/payslips`, `/reminder`, `/review`, `/push` : ces requêtes atteignaient Vite (404). Corrigé par `packages/shared/src/routes.ts` — `API_ROUTE_PREFIXES`, utilisé par le proxy et la liste de refus du service worker ; `apps/api/test/routes.test.ts` vérifie que chaque contrôleur a son préfixe dans la liste (test éprouvé en retirant `/payslips`). Vérifié sur les vrais serveurs : l'import répond 400 JSON au lieu de 404.

### Messages d'erreur (`apps/web/src/`)
- `errors.ts` — `friendlyMessage(status, serverMessage)` : réseau coupé, 400, 401 (session), 403 (droits), 404 (fonction introuvable → mise à jour/redémarrage), 409, 413, 422, 429, 5xx ; ignore les messages techniques anglais, les « Cannot POST … » et les pages HTML.
- `api.ts` — `ApiError` porte désormais le message clair ; échec réseau = statut 0 ; événement `session-expired` quand le renouvellement échoue ; `apiUpload()` aligné.
- `packages/shared` — messages de validation Zod en français (`z.setErrorMap`), `ZodPipe` sans doublons.
- `App.tsx` : retour à la connexion avec explication à l'expiration de la session ; bandeau « Réessayer » si le serveur est injoignable.

### Retours visibles et ergonomie
- `ui.tsx` — `Button` (principal/secondaire/danger/discret, ≥ 44 px, chargement, focus visible), `Icon`, `ToastProvider`/`useToast` (succès/erreur, sans doublon), `ConfirmProvider`/`useConfirm` (dialogue accessible, Échap), `ErrorBanner`.
- `providers.tsx` — `AppProviders` : toute mutation en échec affiche une notification sauf si elle gère son erreur en ligne (`meta.inline`).
- `pages/Dashboard.tsx` — en-tête fixe (masquer les montants, déconnexion), actions rapides, `RowActions` (« Modifier » / « Supprimer » libellés), suppression avec confirmation, textes d'aide.
- `pages/Payslip.tsx` — zone de dépôt, bouton « Choisir un PDF », `checkPdf()` (type, taille, vide) avant envoi, messages précis ; `pages/Weekly.tsx`, `pages/AuthPage.tsx` : boutons et messages harmonisés.

### Tests
- Front : 36 tests (+11) : `friendlyMessage`, confirmation avant suppression, notification sur échec, serveur injoignable, 404 HTML, fichier non PDF, session expirée, boutons visibles. API : 56 tests (+2, routes). Shared : 2 tests (messages en français).

## Amélioration — fiabilité de la lecture des fiches de paie
- **Bug corrigé** (`packages/finance-core/src/payslip.ts`, `normalize`) : les espaces insécables (U+00A0) et fines insécables (U+202F), très fréquents dans les PDF français (« 2 285,40 »), n'étaient pas reconnus comme séparateurs de milliers : net et brut restaient introuvables (fiabilité ~30 %). Toutes les espaces typographiques sont maintenant normalisées.
- `apps/api/src/payslip/pdf-text.ts` — `rebuildLines()` : reconstruit les lignes par position (x, y) ; un libellé et son montant se retrouvent côte à côte même si le PDF écrit les colonnes séparément ou dans le désordre.
- `parsePayslip()` : libellés élargis (« net à verser », « net perçu », « rémunération brute »), plage de dates sans le mot « période » (du…au / tiret, durée ≤ 35 jours), mois en lettres avec tiret ou barre, employeur déduit d'une ligne portant une forme juridique (SAS, SARL, mairie…) à défaut de libellé ; « net social » et « net imposable » jamais retenus.
- `apps/api/scripts/payslip-debug.ts` (`pnpm payslip:debug fichier.pdf [--text] [--anonymize]`) : diagnostic local sans envoi ni enregistrement, avec masquage des chiffres pour partager la structure d'une fiche.
- Front : liste « Éléments détectés » (✓/✗) sous la fiabilité, pour comprendre ce qui manque.
- Tests : finance-core 38 (+6, espaces insécables, colonnes espacées, plages de dates, mois-année, employeur, net après impôt), API 61 (+5 : colonnes écrites dans le désordre dans un vrai PDF, U+00A0, `rebuildLines`), front 37.
- Limite : non validé sur de vraies fiches de paie ; le diagnostic local sert à adapter la lecture à votre logiciel de paie.

## Jalon 7 — Actualités financières
### `packages/finance-core/src/savings.ts`
- `projectSavings({principalCents, monthlyCents, annualRateBp, years, taxRateBp})` : projection d'épargne (intérêts capitalisés chaque mois, versement en fin de mois, calcul décimal arrondi en sortie), capital final, intérêts bruts/nets, impôt, détail par année ; refuse les paramètres hors limites.
- `nextRateRevision(now)` : prochaine révision des taux réglementés (1er février ou 1er août).
- Tests : 11 (taux nul, 12 % sur un an = 1 126,83 €, Livret A, impôt, durée nulle, bornes, dates).

### API (`apps/api/src/market/`)
- `regulated-rates.ts` — `REGULATED_RATES` (Livret A 1,7 %, LDDS 1,7 %, LEP 2,5 % depuis le 1er août 2026 ; période précédente 1,5 % / 1,5 % / 2,5 %), `PEL_RATES` (2,00 % pour 2026), `currentRegulatedRates(now)` (période en vigueur, précédente, drapeau périmé), `currentPelRate(now)`. Sources citées ; CEL non renseigné (non vérifié).
- `savings-products.ts` — 9 fiches (Livret A, LDDS, LEP, PEL, assurance-vie fonds euros, PEA, ETF, obligations d'État, SCPI) et `SAVINGS_DISCLAIMER`.
- `sdmx-csv.ts` — `parseSdmxCsv(csv)` : dernière observation `TIME_PERIOD` / `OBS_VALUE` (BCE `csvdata`, Eurostat `SDMX-CSV`), guillemets et BOM gérés, erreurs claires.
- `indicators.ts` — 3 indicateurs (taux de dépôt BCE, OAT 10 ans France, inflation IPCH France), URL constantes, hôtes autorisés, bornes de vraisemblance.
- `fetch-indicator.ts` — `fetchIndicator()` : https + hôte autorisé, redirections refusées, délai 10 s, réponse ≤ 1 Mo, valeur hors bornes rejetée, aucune donnée envoyée.
- `market.service.ts` — `refresh()` (enregistre en points de base, idempotent, un échec n'arrête pas les autres), `refreshIfDue()` (seulement si une donnée manque ou a plus de 24 h), planificateur interne (toutes les heures, désactivé en test ou avec `MARKET_REFRESH=off`), `indicators()` (états ok / ancienne / indisponible).
- `market.controller.ts` — `GET /market` (taux, variation, prochaine révision, indicateurs, avertissement), `GET /savings/products` ; authentification requise, tous rôles.
- Migration `indicateurs_marche` (`MarketSnapshot`) ; `PrismaService` vérifie aussi cette table au démarrage ; `scripts/market-check.ts` (`pnpm market:check`).

### Front
- `pages/News.tsx` — taux réglementés (variation, révision, alerte périmé), indicateurs avec état, fiches dépliables avec taux officiel et niveau de risque, simulateur d'intérêts (prérempli avec l'épargne, calcul local, validation des saisies) ; `pages/Header.tsx` — navigation Tableau de bord / Actualités (`aria-current`, ancre `#actualites`).
- `money.ts` : `parseAmountOrZero()`, `parsePercentToBp()`, `formatBp()`, `formatDateFr()`.

### Tests
- API 80 (+19 : analyse CSV, taux et périodes, fiches, rafraîchissement avec `fetch` simulé : succès, échec partiel, réponses invraisemblables/malformées/démesurées, hôtes et options d'appel, fréquence, état des indicateurs, authentification, rôle enfant) ; front 47 (+10) ; finance-core 49 (+11).
- Non vérifié : les appels réels à la BCE et à Eurostat (réseau du bac à sable bloqué) ; la structure SDMX-CSV est gérée de façon tolérante, `pnpm market:check` permet de le contrôler chez vous.

## Correctif — indicateurs OAT (404) et inflation (406)
- Constat (`pnpm market:check` chez l'utilisateur) : le taux de dépôt BCE fonctionne (2,50 %, période 2026-09-16) ; l'OAT renvoyait 404 (clé de série `…CI.0.EUR…` incorrecte) et l'inflation 406 (en-tête `Accept: text/csv` en contradiction avec `format=SDMX-CSV` chez Eurostat).
- `fetch-indicator.ts` : en-tête `Accept: */*` (le format est fixé par l'URL) ; `fetchIndicator()` essaie les adresses candidates dans l'ordre et renvoie l'adresse utilisée ; une erreur HTTP est suivie d'un extrait de la réponse (200 caractères, balises retirées) ; si toutes les adresses échouent, l'erreur détaille chaque tentative (hôte, chemin, statut, extrait).
- `indicators.ts` : `urls: string[]` ; OAT 10 ans : BCE `IRS/M.FR.L.L40.CI.0000.EUR.N.Z` (maturité `0000`), repli Eurostat `irt_lt_mcby_m/M.MCBY.FR`.
- `scripts/market-check.ts` : affiche la source utilisée ou toutes les URL testées avec le statut et l'extrait.
- Tests API : 83 (+3 : pas d'`Accept: text/csv`, repli après un 404 dans l'ordre prévu, message détaillé quand tout échoue).
- Non vérifié : la clé `0000` et le repli Eurostat n'ont pas pu être testés (BCE/Eurostat injoignables depuis le bac à sable) ; à confirmer avec `pnpm market:check`.

## Correctif — démarrage de l'API avec un client Prisma obsolète
- Symptôme (PC de l'utilisateur) : `Cannot read properties of undefined (reading 'count')` au démarrage : le client Prisma n'avait pas été régénéré après l'ajout de `MarketSnapshot`.
- `PrismaService.onModuleInit` : un modèle absent du client déclenche le message explicite « modèle … : lancez `prisma migrate deploy` puis `prisma generate` ».
- `apps/api/package.json` : script `predev` (`prisma generate && prisma migrate deploy`) : `pnpm dev` met le client et la base à jour automatiquement. Vérifié : `pnpm dev` génère, applique les migrations (5 trouvées) et l'API répond `/health`.
- Test : 84 tests API (+1 : modèle absent du client).
- `TODO.md` : ajout des objectifs (pas de découvert, épargne de secours, court et long terme, bonnes pratiques) et de la gestion de l'argent de poche des enfants.

## Jalon 8a — Production : images, déploiement privé, sauvegardes, CI/CD
### Configuration de l'API (`apps/api/src/`)
- `secrets.ts` — `loadSecretsFromFiles()` : pour `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `DATABASE_URL`, `VAPID_PRIVATE_KEY`, lit `<NOM>_FILE` (secrets Docker), sans écraser une variable déjà définie, erreurs sans valeur.
- `config.ts` — `assertProductionConfig()` : en production, refuse de démarrer si secrets absents, courts, invalides ou égaux aux valeurs de `.env.example` (message sans aucune valeur) ; `COOKIE_SECURE=0` interdit.
- `bootstrap.ts` (premier import de `main.ts`), `app.ts` : `TRUST_PROXY=1` ; cookies `Secure` en production. Vérifié en vrai : démarrage avec secrets en fichiers, cookie `Secure; HttpOnly; SameSite=Strict`, refus avec la configuration d'exemple.
- `apps/api/package.json` : `@swc-node/register`, `@swc/core`, `prisma` en dépendances d'exécution.

### Images et pile (`infra/`)
- `docker/api.Dockerfile` (structure de dossiers identique au développement, `prisma generate`, utilisateur `node`, `HEALTHCHECK`, tini), `docker/proxy.Dockerfile` (build du front + Caddy non root), `caddy/Caddyfile` (HTTP interne, CSP stricte, HSTS, relais des 13 préfixes d'API, repli SPA, `sw.js` non mis en cache), `.dockerignore`.
- `docker/compose.prod.yml` : postgres, migrate (one-shot), api, proxy, tailscale (profil `prod`, mode userspace sans privilège), backup ; aucun port publié ; réseaux `backend` et `frontend` internes ; `read_only`, `cap_drop: ALL`, `no-new-privileges`, limites de ressources ; secrets en fichiers. `compose.ci.yml` (proxy sur 127.0.0.1:8080, sans Tailscale), `tailscale/serve.json`.

### Sauvegardes (`infra/backup/`)
- `backup.sh` : `pg_dump` → contrôle → chiffrement age avec la clé publique (refuse une clé privée) → copie locale (7) → envoi rclone S3 (35 jours + 12 mensuelles) → `last-success.txt` ; `scheduler.sh` (tous les jours à 03:30 UTC) ; `restore.sh` : déchiffrement avec la clé privée fournie au moment de la restauration, refus de la cible de production sans `RESTORE_FORCE=yes`, comptage des lignes ; `test-backup.sh` : test de bout en bout.
- Vérifié sur un vrai PostgreSQL : fichier sans en-tête pg_dump en clair, restauration impossible avec une mauvaise clé, cible de production bloquée, comptes de lignes identiques après restauration.

### Scripts et CI
- `infra/scripts/init-secrets.sh` (aléatoire fort, droits 600, jamais d'écrasement, mode `--ci`), `smoke.sh` (santé, en-têtes, routage de chaque préfixe en JSON, parcours inscription → compte → résumé ; vérifié contre l'API locale).
- Workflows : `ci.yml` (+ build du front, audit, test de sauvegarde), `security.yml` (Semgrep, CodeQL, Trivy, hadolint), `docker.yml` (build des images, pile + test de fumée, sauvegarde chiffrée, Trivy des images), `release.yml` (GHCR, provenance, SBOM, cosign), `dependabot.yml`.

### Tests et documentation
- API : 113 tests (+29 : secrets, configuration de production, 21 tests d'infrastructure : aucun port publié, durcissement, secrets hors environnement, réseaux, ordre de démarrage, Caddyfile couvrant tous les préfixes, scripts valides, workflows).
- `docs/deploiement.md` (pas à pas VPS + Tailscale + S3 + restauration), `docs/threat-model.md`, README.
- **Non exécuté ici** (pas de démon Docker dans le bac à sable) : construction des images, démarrage de la pile, Tailscale, envoi S3. Vérifiés par la CI GitHub et par le premier déploiement.

## Correctifs issus de la première exécution de la CI (jalon 8a)
- **Failles de dépendances** (`pnpm audit`, 5 hautes + 3 moyennes) : `fastify` (contournement d'authentification, validation, falsification de `X-Forwarded-*`) forcé à `>=5.12.7`, `deepmerge-ts` à `>=8` via `overrides` de `pnpm-workspace.yaml` ; audit propre, 113 tests API toujours verts, migrations et génération Prisma vérifiées.
- **Construction des images** : Corepack échouait (« Cannot find matching keyid ») → pnpm installé via npm dans les Dockerfiles. Les trois images se construisent désormais en CI.
- **Trivy** : l'étiquette de l'action GitHub n'existait pas → exécution via l'image `aquasec/trivy:0.58.1`.
- **Démarrage de la pile** : PostgreSQL ne pouvait pas lire `/run/secrets/postgres_password` (fichier en 600 appartenant à un autre utilisateur que le conteneur, sans contournement possible avec `cap_drop: ALL`). `init-secrets.sh` : dossier `secrets/` en 700 et fichiers en 644 (inaccessibles aux autres utilisateurs de l'hôte grâce au dossier) ; test d'infra adapté.
- Mode `--local` de `init-secrets.sh` et section « Essayer sans VPS » dans `docs/deploiement.md`.
- **Images à jour** (Trivy : 0 HIGH/CRITICAL sur les trois images) : Node 22.23.3 (le tag 22.23.4 n'avait pas d'image publiée), Alpine 3.23, PostgreSQL 16.15, Tailscale 1.104 ; Caddy 2.11.7 recompilé avec Go 1.27 et `golang.org/x/net` 0.60.0 (`proxy.Dockerfile`, étape `caddy-build`) car le binaire officiel embarquait des CVE Go.
- **hadolint** : `api.Dockerfile` avec `SHELL … pipefail` et sans `cd` (DL3003, DL4006).
- **Semgrep** : `CryptoService` fixe `authTagLength: 16` et refuse une étiquette de longueur différente (test ajouté).
- Résultat CI « Images Docker » vert : construction, démarrage de la pile, test de fumée, sauvegarde chiffrée, Trivy.
- **Gitleaks** : faux positif sur la valeur d'exemple publique de `EXAMPLE_SECRETS` (`config.ts`) → `.gitleaks.toml` (règles par défaut + liste d'autorisation des deux valeurs d'exemple) ; vérifié en local (1 fuite sans, 0 avec).

## Jalon 8b — Sécurité par ligne PostgreSQL (RLS)
- `apps/api/prisma/migrations/20261021160000_rls_foyer/migration.sql` : crée les rôles `gest_app` (NOBYPASSRLS) et `gest_system` (BYPASSRLS, droits minimaux, sans accès aux comptes, opérations, règles ni fiches de paie), la fonction `app_household()`, active la RLS et une politique `foyer` (USING + WITH CHECK) sur les 10 tables du foyer, et pose les `GRANT` (audit en écriture seule pour l'application, lecture seule des indicateurs).
- `apps/api/src/prisma/prisma.service.ts` : `scopeClient()` (extension Prisma : chaque requête dans une transaction qui fixe `app.household_id`, accès refusé sans foyer), `$householdTransaction()` (transaction interactive dans le foyer), `runInHousehold()` (contexte asynchrone), jetons `PrismaService` (RLS) et `SystemPrismaService` (hors RLS), `PrismaConnections` (vérifie au démarrage les rôles : refus si `DATABASE_URL` n'est pas `gest_app` ou contourne la RLS, puis les tables).
- `apps/api/src/app.ts` : hook Fastify `onRequest` qui lit le foyer du jeton vérifié et enveloppe toute la requête (`enterWith` dans une garde Nest perdait le contexte après un `await`).
- Services : `AuthService` (inscription, connexion, jetons : client système ; TOTP : RLS), `AuditService` (insertion seule par le client système, `createMany` sans RETURNING), `ReminderService.runOnce` et `MarketService` (client système), `HouseholdController.addMember` (unicité de l'e-mail via le client système), `PayslipController` (`$householdTransaction`).
- `apps/api/scripts/setup-roles.mjs` (`pnpm db:roles`) : pose les mots de passe des rôles à partir des URL, après les migrations ; exécuté par `predev`, `pretest`, le service `migrate` et la CI.
- `config.ts` : en production, `DATABASE_SYSTEM_URL` obligatoire et `DATABASE_OWNER_URL` interdit dans l'API. `schema.prisma` : `directUrl = DATABASE_OWNER_URL` pour les migrations.
- Infra : `compose.prod.yml` (secrets `database_owner_url`, `database_url`, `database_system_url` ; seul `migrate` lit le propriétaire), `init-secrets.sh` (génère les trois URL, convertit l'ancien `database_url`), `backup.sh`/`restore.sh` (droits et politiques inclus dans la sauvegarde, rôles créés à la restauration), `test-backup.sh` (étape 6 : politiques et droits identiques après restauration), `ci.yml`.
- Tests (API : 137, +24) : `rls.int.test.ts` (15 : RLS activée sur toutes les tables, lecture/modification/suppression/écriture interdites entre foyers sans filtre, tables via l'utilisateur, requêtes simultanées, foyer non conservé sur la connexion, transaction interactive atomique, droits de chaque rôle, rôles non super-utilisateurs) ; démarrage et refus de mauvais rôles (`errors.test.ts`) ; configuration de production ; infra (séparation des secrets, migration sans mot de passe). Vérifié que les tests échouent quand la RLS est désactivée sur une table.
- Correctifs de portabilité Windows : `.gitattributes` (LF pour scripts, Dockerfiles, Caddyfile, YAML), test d'infra qui lit `.dockerignore` en CRLF et le droit d'exécution dans l'index Git (`100755`), tests hermétiques vis-à-vis des clés VAPID de l'environnement.
- Docs : README (section « Isolation par ligne », démarrage, dépannage), `docs/threat-model.md`, `docs/deploiement.md`, `TODO.md`.

## Jalon 9a — Prévisionnel de trésorerie et objectifs de comportement
### `packages/finance-core`
- `forecast.ts` : `projectBalance()` (solde projeté de `today` à +30/60/90 jours : points quotidiens, creux, premier jour de découvert sur les comptes courants, événements à venir, revenus et dépenses attendus ; refuse un horizon hors 1 à 366), `accountBalanceAt()` (solde d'un compte à une date : initial + opérations + occurrences échues), `flowsBetween()` (règles + opérations datées, triées), `dailyBalances()` (soldes jour par jour), `addDays()`.
- `goals.ts` : `evaluateBehaviorGoal()` (mois en cours, historique depuis la création sur 12 mois maximum, série de mois réussis) et `evaluateMonth()` pour « pas de découvert » (solde le plus bas, découvert déjà subi ou à venir), « reste à vivre positif » (à surveiller sous 10 % des revenus) et « dépenses sous un plafond » (à surveiller dès 80 %) ; helpers de calendrier `lastDay()`, `addMonthsToMonth()`.
- Tests : 23 nouveaux (couverture du paquet : 100 % des lignes, 97 % des branches).
### API
- `GET /forecast?days=30|60|90` (`forecast.controller.ts`) : solde du jour calculé comme `accountBalanceAt()`, puis `projectBalance()` ; noms des comptes et des échéances ajoutés ; lecture pour tous les rôles.
- `GET /goals/behavior`, `PUT /goals/behavior/:kind` (plafond obligatoire pour `SPENDING_CAP`, interdit sinon), `DELETE /goals/behavior/:kind` (`goals.controller.ts`) : écriture réservée aux adultes, audit sans montant.
- `common/finance-data.ts` : chargement des comptes, règles et opérations du foyer. Table `BehaviorGoal` (migration `objectifs_comportement` avec RLS et droits), préfixes `/forecast` et `/goals` ajoutés à `routes.ts` et au `Caddyfile`.
- Tests (API : 146, +9) : horizon invalide, projection et premier découvert, ce qui est déjà dans le solde n'est pas rejoué, règles récurrentes, enfant en lecture, isolation entre foyers ; objectifs : validation du plafond, statuts du mois, droits, audit, isolation.
### Front
- `pages/Forecast.tsx` (`ForecastPanel`) : horizons 30/60/90 jours, alerte de découvert, courbe SVG accessible (montants masqués en mode confidentialité), prochaines échéances ; `pages/Goals.tsx` (`GoalsPanel`) : trois objectifs avec statut, mesure, série, activation, plafond et retrait. Tests : 4 nouveaux (front : 51).

## Jalon 9b — Objectifs d'épargne (enveloppes virtuelles) et épargne de secours
### `packages/finance-core` (`savingsGoals.ts`)
- `evaluateSavingsGoal()` : avancement (0 à 100 %), reste, mois restants, versement mensuel conseillé et statut (atteint, en bonne voie sur une trajectoire linéaire de la création à l'échéance, en retard, échéance dépassée, sans échéance).
- `advisedMonthly()` : versement de fin de mois qui amène l'épargne à la cible, intérêts mensuels compris (même convention que `projectSavings`, vérifié par le test), arrondi supérieur ; `monthsUntil()` : mois civils restants (un mois entamé compte).
- `emergencyFund()` : cibles de 3 et 6 mois, couverture en dixièmes de mois, alerte sous 3 mois ; `averageMonthlyExpenses()` : moyenne des 3 derniers mois terminés avec activité (repli : mois en cours).
- Tests : 12 nouveaux (couverture 100 %).
### API
- `GET/POST /goals/savings`, `PUT/DELETE /goals/savings/:id`, `POST /goals/savings/:id/contributions`, `DELETE /goals/savings/:id/contributions/:cid` (`savings-goals.controller.ts`) : écriture réservée aux adultes ; un retrait ne peut pas dépasser l'épargne de l'objectif (vérifié dans une transaction), pas plus que la suppression d'un versement ; compte lié vérifié (foyer) et libéré si le compte est supprimé ; audit sans montant.
- `goals.service.ts` : `behavior()` et `savings()` partagés par les pages d'objectifs et par `GET /review/weekly`, qui renvoie désormais l'état des objectifs (comportement, épargne, alerte de secours).
- Tables `SavingsGoal` et `SavingsContribution` (migration `objectifs_epargne` avec RLS et droits).
- Tests (API : 155, +9) : validations, avancement, retraits, suppression, compte lié, épargne de secours, droits (enfant en lecture), audit, isolation, bilan hebdomadaire.
### Front
- `pages/Savings.tsx` : objectifs avec jauge accessible, versements, retraits, historique, modification, suppression avec confirmation, modèles, bandeau d'épargne de secours et comparaison au reste à vivre ; `pages/Weekly.tsx` : section « Objectifs » du bilan. Tests : 6 nouveaux (front : 57).

## Jalon 10 — Catégories et budgets mensuels (enveloppes)
### `packages/finance-core` (`budgets.ts`)
- `categorySpent(categoryId, month, rules, oneOffs)` : dépenses nettes d'une catégorie sur un mois (sorties moins remboursements, toutes les occurrences récurrentes du mois comprises, jamais négatives) ; `null` mesure les opérations sans catégorie.
- `budgetStatus(spent, available)` : `OK`, `WARNING` dès 80 % (`BUDGET_WARNING_PERCENT`), `EXCEEDED` à 100 %.
- `evaluateBudget(budget, categoryId, month, rules, oneOffs)` : plafond, reliquat reporté (cumulé depuis `since` si `rollover`, jamais un dépassement), disponible, dépensé, reste, pourcentage, statut ; refuse un plafond nul.
- Tests : 8 nouveaux (couverture 100 %, finance-core : 92).
### API
- Table `Category` (nom unique par foyer, `monthlyBudgetCents`, `rollover`, `budgetSince`) et colonne `categoryId` (SET NULL) sur `Transaction` et `RecurringRule` ; migration `categories_budgets` avec RLS et droits.
- `categories.controller.ts` : `GET /categories?month=AAAA-MM` (catégories, dépenses, état du budget, dépenses sans catégorie, totaux), `POST`, `PUT /:id`, `DELETE /:id` ; écriture réservée aux adultes ; nom en double → 409 avec message clair ; `budgetSince` fixé au mois où le budget est posé (pas de report rétroactif) ; audit sans montant.
- `categories.service.ts` : `budgets()` partagé avec `GET /review/weekly` (nouveau champ `budgets` : écarts vs budget du mois) ; `assertCategory()` refuse une catégorie d'un autre foyer à la création et à la modification d'une opération ou d'une récurrence (IDOR).
- `/categories` ajouté à `routes.ts` et au `Caddyfile`.
- Tests (API : 162, +7) : validations, unicité, alertes 80 %/100 %, remboursements, récurrences, reclassement, IDOR, report du reliquat, suppression (opérations conservées sans catégorie), droits (enfant en lecture), isolation, audit, bilan hebdomadaire.
### Front
- `pages/Budgets.tsx` : carte « Budgets du mois » (jauge accessible plafonnée à 100 %, statut, reliquat reporté, reste ou dépassement, catégories sans budget, dépenses non classées), création, modification, suppression avec confirmation ; `useCategories()`.
- `pages/Dashboard.tsx` : choix de la catégorie à la saisie, catégorie affichée et modifiable (liste déroulante dans l'édition en ligne) pour les opérations et les récurrences ; `pages/Weekly.tsx` : section « Budgets du mois » du bilan.
- Tests : 5 nouveaux (front : 62).

## Jalon 11a — Import de relevés bancaires (CSV, OFX) et rapprochement
### `packages/finance-core` (`statements.ts`)
- `parseStatement(text)` : détecte OFX ou CSV sur le contenu ; CSV : séparateur deviné (`;`, tabulation, `,`), lignes de préambule de banque ignorées jusqu'à l'en-tête, colonnes repérées (date d'opération plutôt que de valeur, libellé, montant ou débit/crédit), guillemets, BOM ; OFX 1.x (SGML) et 2.x : `DTPOSTED`, `TRNAMT`, `NAME` + `MEMO` sans répétition, `FITID` ; lignes illisibles comptées et signalées.
- `parseStatementAmount()` (« -1 234,56 », « 12.50 », « 1,234.56 », « 42 EUR », signe moins typographique), `parseStatementDate()` (JJ/MM/AAAA, JJ/MM/AA, AAAA-MM-JJ, AAAAMMJJ ; refuse une date impossible), `normalizeLabel()`, `labelSimilarity()`.
- `importKeys(lines)` : clé d'idempotence (identifiant OFX, sinon date, montant, libellé normalisé et rang parmi les lignes identiques).
- `reconcile(lines, existing, rules, toleranceDays)` : déjà importée (même clé, ou même date et montant qu'une opération importée d'un autre fichier), rapprochée d'une saisie manuelle (même montant, ± 2 jours, la plus proche puis le libellé le plus ressemblant), occurrence d'une récurrence, ou nouvelle ; chaque opération ou occurrence ne sert qu'une fois.
- Tests : 11 nouveaux (finance-core : 103).
### API
- Colonne `Transaction.importHash` (unique par compte, migration `import_releves`).
- `imports.controller.ts` : `POST /imports/preview?accountId=` (multipart, 2 Mo, UTF-8 sinon Windows-1252, PDF refusé en 415 avec un message clair, 5 000 lignes maximum, empreintes SHA-256, rien n'est enregistré) ; `POST /imports/confirm` (lignes `CREATE` créées avec `createMany … skipDuplicates`, lignes `LINK` rattachées à une opération saisie à la main du même compte et du même foyer, empreintes déjà présentes ignorées, le tout dans une transaction) ; écriture réservée aux adultes ; audit sans libellé ni montant.
- `/imports` ajouté à `routes.ts` et au `Caddyfile`.
- Tests (API : 166, +4) : droits, compte d'un autre foyer, PDF, taille, en-tête absent, aperçu rapproché, import, réimport sans doublon, double validation, Windows-1252, même relevé en OFX après CSV, rapprochement refusé vers un autre foyer, validations, solde.
### Front
- `pages/StatementImport.tsx` : action rapide « Importer un relevé » ; choix du compte et du fichier (contrôle de l'extension et de la taille avant envoi), aperçu avec résumé, avertissements, statut et rapprochement de chaque ligne, cases cochées par défaut pour les nouvelles et les déjà saisies, import puis notification. Tests : 2 nouveaux (front : 64).

## Jalon 11b — Catégorisation automatique (règles apprises et classifieur local)
### `packages/finance-core` (`categorize.ts`)
- `significantTokens()` (sans bruit bancaire : CB, PRLV, SEPA, VIR…, ni chiffres, ni mois), `labelPattern()` (mot-clé appris : premier mot significatif), `normalizePattern()`, `patternMatches()` (mots entiers : « free » ne correspond pas à « freebox »).
- `matchRule()` : règle saisie avant règle apprise, puis mot-clé le plus long, puis la plus utilisée.
- `trainClassifier()` / `classify()` : bayésien naïf multinomial avec lissage de Laplace, abstention sous 5 exemples, sans mot connu ou sous 60 % de probabilité.
- Compteurs du classifieur en `Map` (alerte CodeQL : un mot comme « constructor » tombait sur une propriété héritée d'objet).
- `suggestCategory()` : règle, sinon classifieur, sinon rien. Tests : 8 nouveaux (finance-core : 111).
### API
- Table `CategoryRule` (mot-clé unique par foyer, source `MANUAL`/`LEARNED`, `hits`, suppression en cascade avec la catégorie ; migration `categorisation_auto` avec RLS et droits).
- `categorizer.service.ts` : `load()` (règles + classifieur entraîné sur les 3 000 dernières opérations classées), `resolve()` (catégorie absente = automatique, `null` = sans, choisie = vérifiée et apprise), `learn()` (le dernier choix l'emporte, une règle saisie n'est jamais modifiée), `applyToUncategorized()`.
- `POST /transactions` et `POST /recurring-rules` : catégorie automatique si absente ; `PATCH` : un reclassement est appris. `POST /imports/preview` : `suggestion` (catégorie et source) pour les lignes à créer ; `POST /imports/confirm` : `categoryId` par ligne (absent = proposition, vérifié contre le foyer), choix appris.
- `GET/POST /categories/rules`, `DELETE /categories/rules/:id`, `POST /categories/auto` ; écriture réservée aux adultes ; audit sans mot-clé.
- Tests (API : 171, +5) : apprentissage et correction, priorité des règles saisies, classement en masse (règle puis classifieur), proposition et choix à l'import, catégorie d'un autre foyer refusée, isolation, droits, audit.
### Front
- `pages/CategoryRules.tsx` (dans la carte des budgets) : « Classer les opérations sans catégorie », règles listées (saisie / apprise · n fois), ajout avec contrôle et suppression.
- `pages/StatementImport.tsx` : catégorie proposée par ligne (« (auto) »), modifiable ; seules les modifications sont envoyées. `pages/Dashboard.tsx` : « Catégorie automatique » par défaut, « Sans catégorie » explicite.

## Jalon 12 — Mot de passe : affichage à la saisie et réinitialisation par e-mail
### API
- `mail/mail.sender.ts` : `MailSender` (abstrait, remplaçable dans les tests) et `SmtpMailSender` (nodemailer 10.3.1, `SMTP_URL`, `MAIL_FROM`) ; sans `SMTP_URL`, rien n'est envoyé ; les erreurs d'envoi sont journalisées sans adresse ni lien.
- `auth.service.ts` : `forgotPassword(email)` (jeton aléatoire de 32 octets, empreinte SHA-256 en base, 30 minutes, les liens précédents sont annulés, lien `APP_URL/?reinitialisation=…`, audit « demandé » ou « non envoyé ») ; `resetPassword()` (usage unique garanti même en double envoi, Argon2id, déverrouillage, révocation de toutes les sessions).
- `POST /auth/password/forgot` : toujours 202, tout de suite (recherche et envoi en arrière-plan : ni la réponse ni son délai ne révèlent si l'adresse existe), 5 demandes par minute et par IP ; `POST /auth/password/reset`.
- Table `PasswordResetToken` (migration `reinitialisation_mdp`, RLS sans droit pour `gest_app`, droits limités pour `gest_system`).
- Configuration : `SMTP_URL` lisible depuis un fichier (`SMTP_URL_FILE`), secret **facultatif** (fichier vide ou commentaire = désactivé) ; en production, `APP_URL` en https obligatoire si `SMTP_URL` est défini.
- Tests (API : 173, +7) : lien envoyé au titulaire seulement, empreinte en base, réinitialisation, déverrouillage, sessions fermées, usage unique, lien expiré ou remplacé, validations, audit sans jeton ni adresse, limite de débit, secret facultatif, contrôle de production.
### Infra
- `compose.dev.yml` : Mailpit (SMTP 1025, interface http://localhost:8025) ; `.env.example` : `SMTP_URL`, `MAIL_FROM`, `APP_URL`.
- `docs/deploiement-ovh.md` : guide de mise en production sur OVH (budget, comptes, VPS, domaine et DNS SPF/DKIM/DMARC, sécurisation du serveur, Tailscale, Portainer limité au réseau privé, SMTP OVH ou Brevo, sauvegardes S3, mises à jour, checklist et dépannage).
- `compose.prod.yml` : secret `smtp_url`, `MAIL_FROM` et `APP_URL` depuis `infra/docker/.env` ; `init-secrets.sh` propose la configuration SMTP (fichier vide sinon) ; `docs/deploiement.md` : section « E-mails ».
### Front
- `pages/AuthPage.tsx` : champ mot de passe avec bouton afficher / masquer (accessible, `aria-pressed`) ; « Mot de passe oublié ? » avec confirmation neutre ; écran « Nouveau mot de passe » ouvert par le lien (confirmation vérifiée avant envoi, adresse nettoyée après succès). `App.tsx` : le lien ouvre cet écran même avec une session ouverte ; un visiteur non connecté ne voit plus « Votre session a expiré » au premier chargement (défaut corrigé).
- Tests : 3 nouveaux (front : 67).

## Jalon 13 — Abonnements détectés et hausses de prix
### `packages/finance-core` (`subscriptions.ts`)
- `detectSubscriptions(transactions, rules, today)` : regroupe par marchand (mot-clé du libellé, compte, sens), reconnaît un rythme hebdomadaire, mensuel ou annuel (médiane des intervalles, au moins la moitié réguliers, 4 / 3 / 2 occurrences minimum), écarte ce qui est arrêté (plus d'une période et demie sans opération) ou déjà couvert par une récurrence (même mot-clé, ou même fréquence et montant à 5 % près) ; renvoie fréquence, montant, prochaine échéance, catégorie la plus fréquente et hausse éventuelle, les plus chers d'abord.
- `detectRuleDrifts()` : dernier prélèvement réel (45 jours) d'une récurrence, à 7 jours d'une échéance, d'un autre montant.
- `priceIncrease()` (≥ 5 % et ≥ 0,50 €), `nextOccurrence()`, `subscriptionKey()`. Tests : 10 nouveaux (finance-core : 121).
### API
- Table `SubscriptionDismissal` (migration `abonnements` avec RLS et droits).
- `subscriptions.service.ts` : `overview()` partagé avec le bilan de la semaine (`subscriptions` : nombre d'abonnements détectés, hausses des récurrences).
- `subscriptions.controller.ts` : `GET /subscriptions`, `POST /subscriptions/dismiss`, `DELETE /subscriptions/dismissed`, `POST /subscriptions/drifts/:ruleId/apply` (écart recalculé côté serveur ; l'ancienne règle s'arrête la veille de l'échéance remplacée, ou est remplacée si c'était sa première ; nouvelle règle au nouveau montant à l'échéance suivante, en une transaction) ; écriture réservée aux adultes ; audit sans libellé ni montant. `/subscriptions` ajouté à `routes.ts` et au `Caddyfile`.
- Tests (API : 184, +6) : détection et hausse, ajout aux récurrences, ignorer et réafficher, application d'un nouveau prix sans double comptage, première échéance, isolation, droits, bilan, audit.
### Front
- `pages/Subscriptions.tsx` : carte « Abonnements détectés » (changements de prix, abonnements sans récurrence, ajout avec nom modifiable, ignorer, réafficher) ; `pages/Weekly.tsx` : section « Abonnements » du bilan. Tests : 3 nouveaux (front : 73).
### Divers
- `TODO.md` : lignes périmées mises à jour (CI, sauvegardes, nombre de tests, outils de sécurité).

## Jalon 14 — Durcissement de la sécurité (force brute, CSRF, injection SQL, sessions)
### API
- `app.ts` : `csrfRejection()` refuse (403) toute requête qui modifie des données si `Sec-Fetch-Site: cross-site` ou si `Origin` n'est ni l'hôte appelé (`Host` / `X-Forwarded-Host`), ni `APP_URL`, ni `CSRF_TRUSTED_ORIGINS` ; plafonds de débit par famille de routes avec compteurs séparés (authentification 10/min, lien de réinitialisation 5/min, PDF 10/min) ; `Cache-Control: no-store` sur toutes les réponses.
- `auth.service.ts` : inscription ouverte seulement sans foyer existant (`registrationOpen()`, `ALLOW_REGISTRATION=1`) ; `assertStrongPassword()` (`password-policy.ts` : mots courants, chiffres seuls, caractères répétés, nom / e-mail / foyer repris) à l'inscription, à l'ajout d'un membre, au changement et à la réinitialisation ; anti-rejeu TOTP (`totpLastStep`, fenêtre ± 1 pas) ; `changePassword()` (ancien mot de passe exigé, échec compté, sessions fermées, nouvelle session) ; `sessionVersion` dans le jeton, incrémentée au changement / à la réinitialisation / au vol de jeton détecté ; sessions fermées en révoquant ET expirant les jetons de rafraîchissement (pas de fausse alerte de vol depuis un autre appareil).
- `auth.guard.ts` : version de session relue en base à chaque requête ; `auth.module.ts` : algorithme HS256 imposé à la signature et à la vérification.
- `GET /auth/registration`, `POST /auth/password/change` ; migration `securite_sessions` (`User.totpLastStep`, `User.sessionVersion`).
- Tests (API : 197, +13) : CSRF (origine, inter-sites, `null`, lecture libre, hôte relayé, APP_URL, origines déclarées), force brute (plafond par IP, verrouillage), sessions coupées (changement de mot de passe, vol de jeton), JWT sans version / autre algorithme / non signé, inscription fermée, politique de mot de passe, absence de SQL non paramétré, libellé piégé stocké tel quel, `no-store`, anti-rejeu TOTP.
### Infra et documentation
- `Caddyfile` : `trusted_proxies` (plages privées et Tailscale) et `X-Forwarded-For {client_ip}` : vraie IP du client pour les limites de débit.
- `docs/threat-model.md` : section jalon 14 et risques résiduels ; `docs/deploiement.md` § 9 ; `.env.example` : `ALLOW_REGISTRATION`, `CSRF_TRUSTED_ORIGINS`.
### Front
- `pages/ChangePassword.tsx` (action rapide « Changer le mot de passe », confirmation vérifiée) ; `pages/AuthPage.tsx` : « Créer un foyer » masqué quand l'inscription est fermée. Tests : 2 nouveaux (front : 75).

## Jalon 15 — État des sauvegardes dans l'application
### Infra
- `infra/backup/backup.sh` : écrit `last-success.json` (date, taille, copie distante `ok` / `none` / `failed`) et, à chaque tentative même en échec, `last-attempt.json` (date, code de sortie), par écriture atomique, dans `BACKUP_STATUS_DIR`. `test-backup.sh` vérifie ces fichiers, l'enregistrement d'un échec et la conservation de la dernière réussite.
- `compose.prod.yml` : volume dédié `backupstatus`, en écriture pour `backup`, en **lecture seule** pour `api` (l'API ne voit jamais les sauvegardes) ; dossier `/backup-status` créé avec le même propriétaire dans les deux images (volume toujours inscriptible par la sauvegarde).
### API
- `backups/backup-status.ts` : `evaluateBackupStatus()` (fonction pure : alerte après 26 h, alerte grave après 50 h ou sans aucune réussite, copie distante absente ou en échec, tentative ratée après la dernière réussite ; problèmes classés du plus grave au moins grave) ; `readBackupStatus()` (fichiers absents ou corrompus tolérés ; non configuré sans `BACKUP_STATUS_DIR`).
- `GET /backups/status` (tout membre connecté, aucune donnée du foyer) ; `/backups` ajouté à `routes.ts` et au `Caddyfile`.
- Tests (API : 202, +5).
### Front
- `pages/BackupStatus.tsx` : alerte en haut du tableau de bord (à vérifier / en danger) et carte « Sauvegardes » (dernière sauvegarde, copie distante, dernière tentative en échec), relues toutes les 30 minutes, rien hors production. Tests : 3 nouveaux (front : 78).
### Divers
- `TODO.md` : lignes du backlog déjà réalisées cochées (rappel hebdomadaire interactif, mode confidentialité, objectifs d'épargne).

## Jalon 16 — Administration du foyer (membres, mot de passe d'un membre, journal d'activité)
### API
- `GET /household/me` (utilisateur connecté et rôle : le front adapte l'écran).
- `GET /household/audit?before=&security=1` : 50 entrées par page du plus récent au plus ancien, curseur `next`, nom de l'auteur, filtre des événements d'authentification ; date du curseur validée.
- `POST /household/members/:id/password` (propriétaire) : `AuthService.resetMemberPassword()` exige le mot de passe du propriétaire (un échec compte comme un échec de connexion), refuse son propre compte et un membre d'un autre foyer (404), applique la politique de mot de passe, déverrouille le membre, incrémente sa version de session et ferme ses sessions ; audit `household.member_password_reset:<rôle>`.
- Tests (API : 207, +5) : identité et rôle, réinitialisation complète (déverrouillage, sessions coupées, ancien mot de passe refusé, propriétaire toujours connecté), refus (mauvais mot de passe du propriétaire compté, mot de passe faible, soi-même, autre foyer, enfant ou adulte non propriétaire), pagination sur 61 entrées, filtre sécurité.
### Front
- `pages/Household.tsx` : carte « Administration du foyer » (propriétaire seulement) : membres et rôles, ajout d'un membre (rôle adulte ou enfant, mot de passe confirmé), nouveau mot de passe pour un membre (confirmation et mot de passe du propriétaire), journal d'activité en français (alertes de sécurité en rouge, « Voir les plus anciens », « Sécurité uniquement »). Tests : 3 nouveaux (front : 81).
- Constat corrigé : depuis la fermeture de l'inscription (jalon 14), aucun écran ne permettait d'ajouter les membres du foyer.

## Jalon 17 — Refonte de l'interface (5 onglets, palette) et tutoriel de première connexion
### Front
- `pages/Shell.tsx` : application connectée en 5 onglets (Accueil, Opérations, Budgets, Objectifs, Plus) avec barre de navigation fixe en bas, en-tête par écran (titre, bouton « Masquer les montants »), bouton « + » qui ouvre la saisie, sous-écrans de Plus avec « Retour », adresses directes (`#operations`, `#budgets`, `#objectifs`, `#plus`, `#plus:<écran>`, `#actualites`, `?bilan=1`).
- `pages/Home.tsx` : accueil réduit à l'essentiel (reste à vivre et avancée du mois, « À faire » : premier compte, bilan dû, budgets à 80 % ou dépassés, abonnements et hausses à vérifier, chaque ligne menant au bon onglet ; budgets les plus entamés ; solde prévu à 30 jours et découvert éventuel).
- `pages/Operations.tsx` (ex-`Dashboard.tsx`) : saisie, imports, comptes, prévisionnel, historique, récurrences. `pages/More.tsx` : onglet Plus en listes courtes (suivi, sécurité, foyer réservé au propriétaire, déconnexion). `pages/Tutorial.tsx` : 5 étapes en plein écran, « Passer le tutoriel » toujours visible, Précédent / Suivant / Terminer, focus sur le titre de chaque étape, Échap ferme. `Header.tsx` supprimé.
- Palette dans `index.css` (`@theme` : jetons `brand-*` et teintes existantes redéfinies), cartes à bordure fine, boutons arrondis, `theme-color` et manifeste PWA aux nouvelles couleurs ; aucune police externe (CSP stricte).
- Tests : 87 (+6 : accueil et « À faire », bouton +, onglet Plus selon le rôle, tutoriel parcouru, passé, relancé) ; tests existants adaptés à la navigation par onglets.
### API
- `User.tutorialSeenAt` (migration `tutoriel`) ; `GET /household/me` renvoie `tutorialDone` ; `POST /household/me/tutorial`. Tests (API : 208, +1).

## Jalon 18 — Comptes personnels et joints, vue par personne
### Base et API
- Migration `comptes_personnels` : `BankAccount.ownerId` (vide = compte joint, sinon titulaire ; clé étrangère `NO ACTION`), fonction `app_user()` ; politiques RLS de `BankAccount` (joint ou titulaire) et de `Transaction`, `RecurringRule`, `PayslipImport` (compte visible), en lecture et en écriture. Comptes existants inchangés (joints).
- `prisma/prisma.service.ts` : `runInHousehold(householdId, fn, userId?)` fixe aussi `app.user_id` ; `app.ts` le lit dans le jeton vérifié.
- `accounts/accounts.controller.ts` : `personal` à la création et dans la liste ; `PATCH { personal }` : le titulaire partage son compte, seul le propriétaire du foyer rend personnel un compte joint (403 sinon) ; journal `account.created:personal`, `account.shared`, `account.made_personal`.
- `summary/summary.controller.ts` : `scope=all|joint|personal` (`SummaryQuery`, `AccountScope` dans `packages/shared`).
- Vue appliquée au prévisionnel et aux budgets : `common/finance-data.ts` (`ownerFilter`, `accountFilter`, `loadHouseholdFinance(…, view)`), `forecast/forecast.controller.ts` et `categories/categories.service.ts` (`budgets(…, view)` : plafonds du foyer, dépenses de la vue) ; `scope` dans `ForecastQuery` et `BudgetQuery`. Le bilan de la semaine reste sur tous les comptes visibles.
- Tests : `personal-accounts.int.test.ts` (visibilité par membre, opérations et récurrences invisibles, IDOR en écriture → 404, reste à vivre, prévisionnel et budgets par vue, partage et droits, enfant) et `rls.int.test.ts` (politiques en base, sans utilisateur, création usurpée refusée). API : 217 tests.
### Front
- `pages/Operations.tsx` : case « Compte personnel » à la création, pastille `OwnershipBadge` (Joint / Personnel), boutons « Partager » (titulaire) et « Rendre personnel » (propriétaire du foyer) avec confirmation.
- `scope.tsx` : vue partagée (`useAccountScope`, `ScopeFilter`, `scopeParam`) mémorisée sur l'appareil, ramenée à « Tout » sans compte personnel visible ; filtre affiché sur l'accueil (reste à vivre et solde à 30 jours), les budgets (`useCategories`) et le prévisionnel. `ui.tsx` : confirmation au ton « neutral » (bouton non destructif). `pages/Household.tsx` : libellés du journal.
- Tests : 93 (+6 : création personnelle et pastilles, rendre personnel par le propriétaire, filtre de l'accueil, filtre absent sans compte personnel, vue partagée entre budgets, prévisionnel et accueil, vue mémorisée ignorée sans compte personnel).

## Jalon 19 — Mes données : export et effacement (RGPD)
### Base et API
- Migration `suppression_donnees` : `BankAccount.ownerId` en `ON DELETE CASCADE` (un membre supprimé emporte ses comptes personnels), `GRANT DELETE ON "Household"` à `gest_app` (limité au foyer courant par la RLS).
- `auth/auth.service.ts` : `verifyPassword(userId, password)` redemande le mot de passe (compte verrouillé → 403, erreur comptée comme un échec de connexion).
- `privacy/privacy.controller.ts` (`/privacy`) : `POST export` (JSON de toutes les données visibles, IBAN déchiffré, journal pour le propriétaire, aucun secret, `format: 1`, inscrit au journal) ; `POST delete-me` (adulte ou enfant, mot de passe + « SUPPRIMER », cookies effacés ; refusé au propriétaire) ; `POST delete-household` (propriétaire, cascade complète). Routes ajoutées au plafond des routes d'authentification, à `routes.ts` et au Caddyfile.
- `household/household.controller.ts` : `POST /household/members/:id/remove` (propriétaire, mot de passe ; pas soi-même ; 404 hors foyer).
- `packages/shared` : `ConfirmPasswordDto`, `DeleteConfirmDto`.
- Tests : `privacy.int.test.ts` (export complet et sans secret ni compte personnel d'autrui, export d'un membre sans journal, verrouillage, suppression de son compte avec conservation des saisies jointes, refus pour le propriétaire, retrait d'un membre et droits, IDOR entre foyers, suppression du foyer sans toucher aux autres). API : 225 tests.
### Front
- `pages/MyData.tsx` (Plus → « Mes données », `#plus:donnees`) : export avec mot de passe et téléchargement du fichier, suppression de son compte ou du foyer (mot de passe + « SUPPRIMER »), avertissement sur les sauvegardes ; retour à la connexion ensuite.
- `pages/Household.tsx` : bouton « Retirer » par membre avec confirmation par mot de passe ; libellés du journal.
- `App.tsx` : la déconnexion vide le cache et passe la session à « déconnecté » sans attendre de nouvelle requête.
- Tests : 96 (+3 : export et téléchargement, suppression de son compte puis connexion, suppression du foyer et retrait d'un membre).
### Documentation
- `docs/rgpd.md` : contenu de l'export, effets de chaque effacement, rotation des sauvegardes et effacement complet.

## Jalon 20 — Passkeys (WebAuthn)
### Base et API
- Migration `passkeys` : table `Passkey` (clé publique, compteur, transports, nom, dates) ; RLS « chacun les siennes » (`userId = app_user()`), `gest_system` en lecture et mise à jour pour la connexion ; suppression en cascade avec l'utilisateur.
- `auth/passkey.service.ts` (`@simplewebauthn/server` 13.3.3) : options d'ajout (mot de passe redemandé, passkey découvrable, vérification de l'utilisateur exigée, attestation « none », passkeys existantes exclues), vérification et stockage ; options de connexion sans identifiant ; connexion (passkey inconnue → 401, signature invalide → 401 journalisé, compte verrouillé → 403, compteur et date d'usage mis à jour, session ouverte sans 2FA) ; liste et suppression. Défis à usage unique, 5 min, en mémoire ; `relyingParty()` : `APP_URL` en production, sinon l'origine vérifiée par la protection CSRF.
- `auth/passkey.controller.ts` (`/auth/passkeys`, cookie `webauthn` HttpOnly limité à ce chemin) ; `AuthService.issueSession` public ; routes d'ajout et de connexion au plafond de l'authentification ; noms des passkeys dans l'export RGPD.
- `packages/shared` : `PasskeyRegisterDto`, `PasskeyLoginDto` (réponse WebAuthn validée).
- Tests : `passkeys.int.test.ts` (seules les deux vérifications cryptographiques sont simulées) : options et stockage, mot de passe exigé, cérémonie rejouée ou absente, réponse mal formée ou refusée, cloisonnement entre membres, connexion sans 2FA, passkey inconnue, signature invalide, compte verrouillé, export, suppression avec le membre. API : 231 tests.
### Front
- `passkeys.ts` (`@simplewebauthn/browser` 13.3.0) : connexion et ajout, messages clairs (annulation, appareil déjà inscrit, https requis).
- `pages/AuthPage.tsx` : bouton « Se connecter avec une passkey » si le navigateur les gère. `pages/Passkeys.tsx` (Plus → Sécurité → Passkeys, `#plus:passkeys`) : liste, ajout, suppression avec confirmation. Libellés du journal.
- Tests : 99 (+3 : connexion par passkey, annulation et navigateur sans prise en charge, ajout, liste et suppression).

## Correctifs de sécurité des dépendances (novembre 2026)
- `zod` 3 → 4.6.7 (GHSA-mrhx-c7xc-m3w5, épuisement mémoire) : `packages/shared/src/index.ts` passe de `z.setErrorMap` à `z.config({ customError })` (mêmes messages français, codes de zod 4 : `invalid_format`, `invalid_value`, `origin`) ; `ZodPipe` typé avec `ZodType`. `pnpm audit --prod` sans vulnérabilité.
- Image proxy : `go-jose` relevé en 4.1.6 (CVE-2026-116587) et `golang.org/x/net` en 0.62.0 (CVE-2026-78661) dans la compilation de Caddy, signalés par Trivy.
- CI : job `build-test` épinglé sur Ubuntu 24.04 avec `postgresql-client-16` (le runner `ubuntu-latest` installait le client 18, dont le dump ne se restaure pas sur PostgreSQL 16).

## Circuit Git : branche `develop`
- `ci.yml`, `docker.yml` : push sur `main`, `develop`, `claude/**` et toute pull request ; `security.yml` : push sur `main` et `develop`, pull requests, lundi, lancement manuel ; `release.yml` : tags `v*`.
- README : section « Circuit de travail » (branches, pull requests, protections conseillées) ; `CLAUDE.md` : règle du circuit ; test d'infrastructure sur les déclencheurs (API : 114 tests).
