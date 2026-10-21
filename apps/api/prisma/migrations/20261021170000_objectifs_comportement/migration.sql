-- CreateEnum
CREATE TYPE "BehaviorKind" AS ENUM ('NO_OVERDRAFT', 'POSITIVE_REMAINING', 'SPENDING_CAP');

-- CreateTable
CREATE TABLE "BehaviorGoal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" "BehaviorKind" NOT NULL,
    "capCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BehaviorGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BehaviorGoal_householdId_kind_key" ON "BehaviorGoal"("householdId", "kind");

-- AddForeignKey
ALTER TABLE "BehaviorGoal" ADD CONSTRAINT "BehaviorGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sécurité par ligne (voir la migration rls_foyer) : comme toutes les tables du foyer.
ALTER TABLE "BehaviorGoal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "BehaviorGoal" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());
GRANT SELECT, INSERT, UPDATE, DELETE ON "BehaviorGoal" TO gest_app;
