-- Sécurité par ligne (RLS) : défense en profondeur de l'isolation entre foyers.
--
-- Deux rôles de connexion sans droit sur le schéma (les mots de passe sont posés par scripts/setup-roles.ts, jamais ici) :
--   gest_app    : requêtes des utilisateurs connectés. Soumis à la RLS : ne voit que le foyer fixé par `app.household_id`.
--   gest_system : opérations d'avant connexion (inscription, connexion, jetons), journal d'audit, planificateur de rappels et
--                 indicateurs de marché. Contourne la RLS mais n'a de droits que sur les tables strictement nécessaires.
-- Le propriétaire des tables (rôle des migrations) n'est utilisé ni par l'API ni par les requêtes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gest_app') THEN
    CREATE ROLE gest_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gest_system') THEN
    CREATE ROLE gest_system LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO gest_app, gest_system', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO gest_app, gest_system;

-- Foyer courant de la transaction (posé par l'API avec set_config(..., true)) ; vide = aucun accès.
CREATE FUNCTION app_household() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.household_id', true), '') $$;
GRANT EXECUTE ON FUNCTION app_household() TO gest_app, gest_system;

-- Tables rattachées directement à un foyer.
ALTER TABLE "Household" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "Household" TO gest_app USING (id = app_household()) WITH CHECK (id = app_household());

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "User" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "AuditLog" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());

ALTER TABLE "BankAccount" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "BankAccount" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());

ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "Transaction" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());

ALTER TABLE "RecurringRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "RecurringRule" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());

ALTER TABLE "PayslipImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "PayslipImport" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());

-- Tables rattachées à un utilisateur : le foyer est celui de l'utilisateur.
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "RefreshToken" TO gest_app
  USING ("userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()))
  WITH CHECK ("userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()));

ALTER TABLE "ReminderSetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "ReminderSetting" TO gest_app
  USING ("userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()))
  WITH CHECK ("userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()));

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "PushSubscription" TO gest_app
  USING ("userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()))
  WITH CHECK ("userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()));

-- MarketSnapshot : données publiques, sans RLS (lecture seule pour gest_app).

-- Droits de gest_app (utilisateur connecté) : jamais d'écriture dans le journal d'audit ni dans les indicateurs.
GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "BankAccount", "Transaction", "RecurringRule", "PayslipImport",
  "ReminderSetting", "PushSubscription", "RefreshToken" TO gest_app;
GRANT SELECT, UPDATE ON "Household" TO gest_app;
GRANT SELECT ON "AuditLog", "MarketSnapshot" TO gest_app;

-- Droits de gest_system : uniquement ce que l'inscription, la connexion, l'audit, le rappel et les indicateurs exigent.
-- Aucun accès aux comptes, opérations, règles récurrentes ni fiches de paie.
GRANT SELECT, INSERT ON "Household" TO gest_system;
GRANT SELECT, INSERT, UPDATE ON "User", "RefreshToken" TO gest_system;
GRANT INSERT ON "AuditLog" TO gest_system;
GRANT SELECT, UPDATE ON "ReminderSetting" TO gest_system;
GRANT SELECT, DELETE ON "PushSubscription" TO gest_system;
GRANT SELECT, INSERT, UPDATE ON "MarketSnapshot" TO gest_system;
