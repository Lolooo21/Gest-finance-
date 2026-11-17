-- CreateEnum
CREATE TYPE "RuleSource" AS ENUM ('MANUAL', 'LEARNED');

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "RuleSource" NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_householdId_pattern_key" ON "CategoryRule"("householdId", "pattern");

-- CreateIndex
CREATE INDEX "CategoryRule_categoryId_idx" ON "CategoryRule"("categoryId");

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sécurité par ligne (voir la migration rls_foyer) : comme toutes les tables du foyer.
ALTER TABLE "CategoryRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "CategoryRule" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());
GRANT SELECT, INSERT, UPDATE, DELETE ON "CategoryRule" TO gest_app;
