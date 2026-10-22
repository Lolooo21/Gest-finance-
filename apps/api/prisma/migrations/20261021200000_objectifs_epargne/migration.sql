-- CreateEnum
CREATE TYPE "SavingsKind" AS ENUM ('EMERGENCY', 'SHORT_TERM', 'LONG_TERM');

-- CreateTable
CREATE TABLE "SavingsGoal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SavingsKind" NOT NULL,
    "targetCents" INTEGER NOT NULL,
    "targetDate" DATE,
    "accountId" TEXT,
    "annualRateBp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsContribution" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavingsGoal_householdId_idx" ON "SavingsGoal"("householdId");

-- CreateIndex
CREATE INDEX "SavingsContribution_goalId_date_idx" ON "SavingsContribution"("goalId", "date");

-- CreateIndex
CREATE INDEX "SavingsContribution_householdId_idx" ON "SavingsContribution"("householdId");

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sécurité par ligne (voir la migration rls_foyer) : comme toutes les tables du foyer.
ALTER TABLE "SavingsGoal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "SavingsGoal" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());
ALTER TABLE "SavingsContribution" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "SavingsContribution" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());
GRANT SELECT, INSERT, UPDATE, DELETE ON "SavingsGoal", "SavingsContribution" TO gest_app;
