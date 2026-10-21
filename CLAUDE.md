# Règles de travail

- **Avant tout codage**, lire `TODO.md` (reste à faire, statuts) et `DONE.md` (déjà réalisé, résumé par fonction).
- Pendant le travail : mettre à jour le statut dans `TODO.md` (`À faire` → `En cours` → `En test` → `Terminé`).
- Une fois testé : retirer la tâche de `TODO.md` (ou la marquer `Terminé`) et l'ajouter à `DONE.md` avec un résumé par fonction (fichier, rôle, tests).
- Commits en français, Conventional Commits, une seule ligne.
- **À chaque itération**, mettre à jour `README.md` : schéma de base de données (diagramme Mermaid et texte explicatif), tableau des fonctionnalités en place, section « à venir » et démarrage si nécessaire.
- Tout nouveau contrôleur de l'API : ajouter son préfixe dans `packages/shared/src/routes.ts` **et** dans `infra/caddy/Caddyfile` (deux tests le vérifient).
- Circuit Git : branche de fonctionnalité -> pull request vers `develop` -> fusion de `develop` dans `main` pour une version -> tag `v*` (publication des images). Ne jamais pousser directement sur `main` ou `develop` hors pull request.
