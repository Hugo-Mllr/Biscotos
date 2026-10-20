# Biscotos — amis, ligue et points

## Les cercles

Un **cercle** est un groupe d'amis (jusqu'à 30 personnes ; chaque profil peut être dans 5 cercles).

- On le crée depuis **Ligue → Créer ou rejoindre un cercle**. Il reçoit un **code** (`ABCD-EFGH`)
  que chaque membre voit et peut partager.
- Rejoindre = taper le code. Un code faux et un code mal formé reçoivent la même réponse ;
  10 essais par minute et par profil, 20 par adresse.
- Le **propriétaire** peut renommer le cercle, changer le code (l'ancien cesse aussitôt de
  marcher), retirer un membre ou supprimer le cercle. S'il quitte le cercle, celui-ci passe au
  membre le plus ancien ; le dernier à partir supprime le cercle.

## Ce que chacun partage

Un seul réglage pour tous ses cercles (**Ligue → bouclier**), choisi aussi au moment de rejoindre :

| Interrupteur | Ce que les amis voient | Jamais |
|---|---|---|
| Points, séances et série (activé) | points et leur détail, nombre de séances, série | les charges, les exercices, les notes |
| Records personnels (activé) | le **nombre** de records de la semaine | quels exercices, quelles charges |
| Jours dans mon objectif calorique (désactivé) | des points « journée dans l'objectif » | ce qui a été mangé, l'objectif lui-même |
| Mes meilleures charges, en fantôme (désactivé) | ton meilleur set par exercice, pendant leur séance | le reste de tes séances, tes notes |

Le **poids corporel et les mensurations ne sont jamais partagés**. Un membre qui désactive le
premier interrupteur apparaît sans aucun chiffre.

## Les points (calculés par le serveur)

Ils récompensent l'effort **par rapport à son propre niveau**, jamais la charge brute.

| Action | Points | Limite |
|---|---|---|
| Séance enregistrée (au moins une série de travail validée) | 10 | 2 par jour |
| Record personnel : meilleur 1RM estimé (Epley, séries ≤ 12 reps) jamais atteint sur un exercice | 25 | 5 par semaine ; la toute première fois sur un exercice ne compte pas |
| Progression : 1RM estimé de la semaine contre les 4 semaines d'avant, moyenne des exercices | +1 % = 10 | 30 |
| Plan respecté : autant de séances que de jours d'entraînement dans le plan hebdo | 40 | — (pas de plan hebdo ou rotation : 0) |
| Journée dans l'objectif : calories à ±10 % de l'objectif (si partagé) | 5 | 7 jours |

Garde-fous : séances datées dans le futur ignorées, 1RM estimé > 1000 ignoré, échauffements
ignorés, et **toute donnée `source: 'strava'` est exclue** (les conditions de Strava interdisent
les classements) — un seul point d'entrée, `usableWorkouts`, testé.

**Ligue hebdo** : la semaine va du lundi au dimanche, à minuit sur l'horloge du serveur
(`TZ=Europe/Paris` dans `.env`). L'écran montre cette semaine, la semaine dernière et la
**saison** (total depuis l'arrivée dans le cercle, 52 semaines au plus).

## La série et le joker

La **série** compte les semaines d'affilée avec au moins une séance. La semaine en cours compte
dès la première séance ; tant qu'elle est vide, la série de la semaine d'avant tient toujours.

Un **joker par mois** comble automatiquement **une** semaine ratée isolée (le mois du lundi de
cette semaine). Deux semaines ratées de suite cassent la série.

## Fil d'activité, réactions, notifications (PR 2, en cours)

- **Fil** (écran Ligue) : séances des 14 derniers jours des membres qui partagent l'entraînement
  (nom, durée, nombre d'exercices, nombre de records si partagés — jamais de charge), arrivées.
- **Réactions** 💪 🔥 🍪 👏 😮 : une par personne et par séance ; gardées 30 jours dans `social.json`.
- **Notifications** (interrupteur « Notifications », activé par défaut) : réaction à ta séance,
  record d'un pote, **bilan du lundi** à 9 h (podium de la semaine passée ; « mur de la honte »
  des 0 point, désactivable par le propriétaire du cercle).

## Technique

- `api/social/score.js` : règles pures, testées (`api/test/social-score.test.js`).
- `api/social/store.js` : `data/social.json` (0600) — cercles, membres, préférences.
- `api/social/routes.js` : routes `/api/social/*`, documentées dans `api/openapi.yaml`.
  Un cercle dont on n'est pas membre répond 404 comme un cercle inexistant ; les membres sont
  désignés par une clé opaque (HMAC du cercle et du profil), jamais par leur uid.
  Tests d'autorisation de chaque route : `api/test/social-routes.test.js`.
- Un profil supprimé par l'admin quitte tous ses cercles et ses préférences sont oubliées.
- Écrans : `frontend/src/views/League.jsx`, carte d'accueil `components/LeagueToday.jsx`.

## Qui est à la salle ?

Un bouton « Je suis à la salle » dans l'écran du cercle. C'est un choix explicite : la présence
n'est gardée qu'en mémoire du serveur (jamais écrite sur disque), expire seule au bout de 3 h,
disparaît au redémarrage, et n'est visible que des membres d'un cercle commun (404 sinon).

## Défi de la semaine et badges

Un défi **collectif** par semaine, qui change à tour de rôle : séances à plusieurs (3 par
personne, 5 séances comptées au plus par personne), records à plusieurs, ou la moitié du cercle
qui tient son plan de la semaine. Il n'existe qu'à partir de deux membres qui partagent leur
entraînement. Les **badges** sont des paliers sur tout l'historique : séances (10, 50, 100, 250),
série en semaines (4, 12, 26, 52), records (10, 50, 100 ; seulement si les records sont partagés).
Tout est calculé à la demande (`api/social/badges.js`), rien n'est stocké, et les séances Strava
ne comptent pas.

## Le fantôme d'un pote

Pendant une séance, sous chaque exercice en répétitions, une ligne « 👻 Sam : 100 kg × 5 »
montre le meilleur set d'un pote sur ce même exercice : le plus fort des potes qui partagent, avec
« +2 potes » s'il y en a d'autres. Le meilleur set est celui qui a le plus haut 1RM estimé, selon
les mêmes règles que les records : séries de travail cochées, 12 répétitions au plus.

C'est le seul endroit où une charge est montrée aux autres. Le partage est donc **désactivé par
défaut** : chacun l'active dans Ligue → « Mes meilleures charges, en fantôme », qui demande aussi
le partage de l'entraînement. Le serveur répond avec le nom affiché seulement (`GET
/api/social/ghosts?ex=…`, 30 exercices au plus), jamais un uid, et jamais ses propres charges à
celui qui demande. L'appli fait un seul appel pour tous les exercices de l'écran et garde la
réponse 5 minutes.
