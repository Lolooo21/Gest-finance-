-- CreateTable
CREATE TABLE "PayslipImport" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "netCents" INTEGER NOT NULL,
    "grossCents" INTEGER,
    "employer" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayslipImport_transactionId_key" ON "PayslipImport"("transactionId");

-- CreateIndex
CREATE INDEX "PayslipImport_householdId_accountId_periodMonth_idx" ON "PayslipImport"("householdId", "accountId", "periodMonth");

-- AddForeignKey
ALTER TABLE "PayslipImport" ADD CONSTRAINT "PayslipImport_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipImport" ADD CONSTRAINT "PayslipImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipImport" ADD CONSTRAINT "PayslipImport_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
