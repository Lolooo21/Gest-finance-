# Modèle de menaces (v0, STRIDE simplifié)

| Menace | Mesure prévue |
|---|---|
| Usurpation (S) | Argon2id, 2FA TOTP, cookies HttpOnly/SameSite=Strict, rate limiting |
| Altération (T) | Validation Zod, transactions SQL, AuditLog |
| Répudiation (R) | AuditLog sans données financières |
| Fuite d'information (I) | TLS, AES-256-GCM sur IBAN/documents, RLS par foyer, logs filtrés, parsing 100 % local |
| Déni de service (D) | Rate limiting, limites de taille d'upload, jobs isolés dans le worker |
| Élévation de privilèges (E) | Garde `householdId`, rôles OWNER/MEMBER, conteneurs non-root |

## Import de fiches de paie (jalon 6)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| PDF malveillant (exécution, bombe de décompression) | Taille 5 Mo, signature `%PDF-`, pdfjs sans `eval` ni polices système, 5 pages maximum, limitation à 10 imports/min, réservé OWNER/ADULT | L'extraction tourne dans le processus de l'API (pas de délai maximal) : à isoler dans un worker |
| Fuite des données de paie | Fichier lu en mémoire puis jeté, jamais écrit sur disque ; texte extrait jamais journalisé ; audit sans montants | Mémoire du processus pendant la lecture |
| Valeurs erronées enregistrées | Validation humaine obligatoire, indice de fiabilité, avertissements, anti-doublon | Une erreur de lecture validée sans contrôle |
