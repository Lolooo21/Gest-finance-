# Modèle de menaces (v0, STRIDE simplifié)

| Menace | Mesure prévue |
|---|---|
| Usurpation (S) | Argon2id, 2FA TOTP, cookies HttpOnly/SameSite=Strict, rate limiting |
| Altération (T) | Validation Zod, transactions SQL, AuditLog |
| Répudiation (R) | AuditLog sans données financières |
| Fuite d'information (I) | TLS, AES-256-GCM sur IBAN/documents, RLS par foyer, logs filtrés, parsing 100 % local |
| Déni de service (D) | Rate limiting, limites de taille d'upload, jobs isolés dans le worker |
| Élévation de privilèges (E) | Garde `householdId`, rôles OWNER/MEMBER, conteneurs non-root |
