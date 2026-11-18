# Données personnelles : export et effacement

Gest-finance est auto-hébergé : les données d'un foyer ne quittent jamais votre serveur, sauf pour les sauvegardes chiffrées. Cette page décrit les droits d'accès, de portabilité et d'effacement, et ce qui se passe réellement dans la base.

## Exporter ses données (Plus → Mes données)

Chaque membre télécharge un fichier JSON (`gest-finance-export-AAAA-MM-JJ.json`) avec tout ce qu'il voit dans l'application :

- le foyer, son profil et la liste des membres ;
- les comptes (joints et ses comptes personnels), **IBAN en clair** ;
- les opérations, récurrences, catégories et budgets, règles de catégorisation ;
- les objectifs de comportement et d'épargne avec leurs versements ;
- les fiches de paie importées (net, brut, employeur, période), les abonnements ignorés et le réglage du rappel ;
- le journal d'activité, **pour le propriétaire seulement**.

Le fichier n'en contient jamais :

- les comptes personnels des autres membres ;
- le moindre secret : empreinte de mot de passe, secret 2FA, jetons de session, abonnements push, IBAN chiffré.

Montants en centimes (négatif = sortie), dates `AAAA-MM-JJ`, champ `format` pour la version du format.

Le mot de passe est redemandé : une erreur compte comme un échec de connexion, et le compte se verrouille 15 minutes au 5e échec. L'export est inscrit au journal (`privacy.exported`). **Le fichier contient vos données en clair : rangez-le en lieu sûr.**

## Effacer des données

| Qui | Action | Ce qui est effacé | Ce qui reste |
|---|---|---|---|
| Adulte ou enfant | Plus → Mes données → « Supprimer mon compte » | Son compte, ses sessions, son rappel, ses appareils (push) et ses **comptes personnels** avec leurs opérations, récurrences et fiches de paie | Ce qu'il a saisi sur les comptes joints (données du foyer) ; les lignes du journal d'activité le concernant (sans nom) |
| Propriétaire | Administration du foyer → « Retirer » un membre | Comme ci-dessus, pour ce membre | Idem |
| Propriétaire | Plus → Mes données → « Supprimer le foyer » | **Tout** : membres, comptes, opérations, objectifs, catégories, journal d'activité | Rien dans la base |

Chaque effacement exige le mot de passe de la personne connectée. La suppression de son compte ou du foyer exige aussi de taper `SUPPRIMER`. Le propriétaire ne peut pas supprimer seulement son propre compte : il supprime le foyer entier.

Dans la base, la suppression d'un membre emporte ses comptes personnels par cascade (`BankAccount.ownerId`, `ON DELETE CASCADE`). La suppression du foyer emporte toutes les tables rattachées. Les sessions déjà ouvertes sont refusées immédiatement, car le membre n'existe plus.

## Sauvegardes

Les sauvegardes chiffrées (age) déjà réalisées contiennent encore les données effacées jusqu'à leur rotation :

- 7 sauvegardes sur le serveur (`KEEP_LOCAL`) ;
- 35 jours de sauvegardes quotidiennes à distance (`KEEP_REMOTE_DAYS`) ;
- 12 sauvegardes mensuelles à distance (`KEEP_MONTHLY`).

Elles restent illisibles sans la clé privée, qui ne se trouve pas sur le serveur. Pour un effacement immédiat et complet (départ définitif du foyer, par exemple), supprimez aussi les fichiers `*.age` du volume `backups` et du stockage distant (`rclone delete`), puis relancez une sauvegarde.

**Attention :** une restauration d'une sauvegarde antérieure fait réapparaître les données effacées depuis. Refaites alors l'effacement.
