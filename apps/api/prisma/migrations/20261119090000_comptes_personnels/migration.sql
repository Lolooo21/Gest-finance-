-- Comptes personnels et joints : un compte dont "ownerId" est renseigné n'est visible que par son titulaire.
-- Un membre titulaire de comptes personnels ne peut pas être supprimé seul (NO ACTION) ; la suppression du foyer emporte tout.
-- Les comptes existants restent joints (ownerId NULL), visibles par tout le foyer comme avant.
ALTER TABLE "BankAccount" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "BankAccount_ownerId_idx" ON "BankAccount"("ownerId");

-- Utilisateur courant de la transaction (posé par l'API avec set_config(..., true)) ; vide = seuls les comptes joints sont visibles.
CREATE FUNCTION app_user() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
GRANT EXECUTE ON FUNCTION app_user() TO gest_app, gest_system;

-- Compte : du foyer, et joint ou à l'utilisateur courant. On ne peut créer un compte personnel que pour soi.
DROP POLICY foyer ON "BankAccount";
CREATE POLICY foyer ON "BankAccount" TO gest_app
  USING ("householdId" = app_household() AND ("ownerId" IS NULL OR "ownerId" = app_user()))
  WITH CHECK ("householdId" = app_household() AND ("ownerId" IS NULL OR "ownerId" = app_user()));

-- Opérations, récurrences et fiches de paie : visibles seulement si leur compte l'est (la sous-requête est elle-même filtrée par la RLS).
DROP POLICY foyer ON "Transaction";
CREATE POLICY foyer ON "Transaction" TO gest_app
  USING ("householdId" = app_household() AND "accountId" IN (SELECT id FROM "BankAccount"))
  WITH CHECK ("householdId" = app_household() AND "accountId" IN (SELECT id FROM "BankAccount"));

DROP POLICY foyer ON "RecurringRule";
CREATE POLICY foyer ON "RecurringRule" TO gest_app
  USING ("householdId" = app_household() AND "accountId" IN (SELECT id FROM "BankAccount"))
  WITH CHECK ("householdId" = app_household() AND "accountId" IN (SELECT id FROM "BankAccount"));

DROP POLICY foyer ON "PayslipImport";
CREATE POLICY foyer ON "PayslipImport" TO gest_app
  USING ("householdId" = app_household() AND "accountId" IN (SELECT id FROM "BankAccount"))
  WITH CHECK ("householdId" = app_household() AND "accountId" IN (SELECT id FROM "BankAccount"));
