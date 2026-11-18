-- Droit à l'effacement (RGPD).
-- Supprimer un membre efface aussi ses comptes personnels (et, par cascade, leurs opérations, récurrences et fiches de paie) :
-- personne d'autre ne peut les voir, les garder les rendrait orphelins et invisibles.
ALTER TABLE "BankAccount" DROP CONSTRAINT "BankAccount_ownerId_fkey";
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Le propriétaire peut supprimer son foyer (la politique RLS « foyer » limite au foyer courant) : tout part en cascade.
GRANT DELETE ON "Household" TO gest_app;
