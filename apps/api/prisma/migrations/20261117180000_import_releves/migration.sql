-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "importHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_accountId_importHash_key" ON "Transaction"("accountId", "importHash");
