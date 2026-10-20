-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueBp" INTEGER NOT NULL,
    "observedAt" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSnapshot_key_fetchedAt_idx" ON "MarketSnapshot"("key", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_key_observedAt_key" ON "MarketSnapshot"("key", "observedAt");
