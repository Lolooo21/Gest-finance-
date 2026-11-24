-- Session révocable : chaque connexion (appareil) a un identifiant, commun à sa chaîne de refresh tokens et porté par le jeton
-- d'accès. À la déconnexion, la session n'a plus de jeton actif et ses jetons d'accès sont refusés aussitôt.
-- Les jetons existants deviennent chacun leur propre session (les jetons d'accès émis avant sont renouvelés par le front).
ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" TEXT;
UPDATE "RefreshToken" SET "sessionId" = "id";
ALTER TABLE "RefreshToken" ALTER COLUMN "sessionId" SET NOT NULL;
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");
