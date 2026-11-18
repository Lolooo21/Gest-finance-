-- Passkeys (WebAuthn) : connexion par empreinte, visage ou code de l'appareil. Seule la clé PUBLIQUE est stockée.
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chacun ne voit et ne gère que SES passkeys (même le propriétaire du foyer ne voit pas celles des autres).
ALTER TABLE "Passkey" ENABLE ROW LEVEL SECURITY;
CREATE POLICY foyer ON "Passkey" TO gest_app
  USING ("userId" = app_user() AND "userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()))
  WITH CHECK ("userId" = app_user() AND "userId" IN (SELECT id FROM "User" WHERE "householdId" = app_household()));
GRANT SELECT, INSERT, DELETE ON "Passkey" TO gest_app;
-- Connexion par passkey (avant toute session) : lecture de la clé publique, mise à jour du compteur et de la date d'usage.
GRANT SELECT, UPDATE ON "Passkey" TO gest_system;
