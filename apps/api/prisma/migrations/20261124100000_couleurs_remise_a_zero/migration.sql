-- Couleur pastel de repère des comptes et des budgets (clé de PASTEL_COLORS, validée par l'API) ; null = aucune.
ALTER TABLE "BankAccount" ADD COLUMN "color" TEXT;
ALTER TABLE "Category" ADD COLUMN "color" TEXT;

-- Remise à zéro d'un budget : dans le mois de cette date, seules les dépenses à partir de ce jour comptent.
ALTER TABLE "Category" ADD COLUMN "budgetResetAt" DATE;
