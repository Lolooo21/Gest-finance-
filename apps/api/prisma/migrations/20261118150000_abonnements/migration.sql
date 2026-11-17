-- CreateTable
CREATE TABLE "SubscriptionDismissal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionDismissal_householdId_key_key" ON "SubscriptionDismissal"("householdId", "key");

-- AddForeignKey
ALTER TABLE "SubscriptionDismissal" ADD CONSTRAINT "SubscriptionDismissal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sécurité par ligne (voir la migration rls_foyer) : comme toutes les tables du foyer.
ALTER TABLE "SubscriptionDismissal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "SubscriptionDismissal" TO gest_app USING ("householdId" = app_household()) WITH CHECK ("householdId" = app_household());
GRANT SELECT, INSERT, UPDATE, DELETE ON "SubscriptionDismissal" TO gest_app;
