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
