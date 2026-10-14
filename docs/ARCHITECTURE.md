# Biscotos — architecture cible

> Point de départ : `docs/AUDIT.md`. Contraintes : < 15 utilisateurs, homelab Docker, 0 €,
> dépôt public, données de santé = données sensibles, et règle upstream « dependency-light ».

## 1. Principes

1. **Ne pas casser openGym.** L'entraînement, le poids et les mensurations restent dans le
   document d'état existant (`state-<uid>.json`), synchronisé par `sync-merge.js`. On n'y touche pas.
2. **Les nouveaux domaines Biscotos vivent côté serveur, dans des fichiers séparés**, avec des
   routes REST classiques. Raisons :
   - le moteur de fusion multi-appareils d'openGym est subtil (copie client + copie serveur +
     test de parité) ; y greffer la nutrition multiplierait le risque de régression ;
   - des entrées adressées par `id` côté serveur permettent un **contrôle d'appartenance explicite
     par route** (et un test d'autorisation par route, exigé par le brief) ;
   - le social et les leaderboards demandent de toute façon un calcul serveur à partir des données
     de plusieurs utilisateurs, filtré par le consentement de chacun.
3. **Le `uid` vient toujours de la session**, jamais d'un paramètre. Un `id` d'entrée inconnu
   **ou appartenant à quelqu'un d'autre** répond `404` (pas `403` : on ne confirme pas l'existence).
4. **Zéro dépendance ajoutée.** `fetch` natif (Node 22) pour Open Food Facts, `node:crypto` pour
   les jetons, fichiers JSON écrits avec l'`atomicWrite` existant.
5. **Chaque donnée a une `source`** (`manual`, `off`, `apple-health`, `health-connect`, `fit`,
   `gpx`, `strava`) dès la conception : c'est ce qui permet de faire respecter les règles Strava.

## 2. Stockage

Tout reste sous `DATA_DIR` (déjà sauvegardé par l'utilisateur, déjà hors git) :

```
data/
  db.json                       comptes, passkeys, invitations          (openGym)
  state-<uid>.json              entraînement, poids, mensurations       (openGym)
  nutrition-<uid>.json          journal, aliments perso, objectifs, taille   ← Phase 1
  food-cache.json               cache Open Food Facts (public, non personnel) ← Phase 1
  health-<uid>.json             mesures importées (pas, sommeil, FC…)   ← Phase 2
  social.json                   groupes, membres, préférences de partage ← Phase 3
  integrations.json             jetons webhook hachés, liens Strava     ← Phase 2/4
```

Fichiers JSON plutôt que SQLite : à < 15 utilisateurs c'est largement suffisant, cohérent avec
l'existant, sauvegardable avec un `cp`. `node:sqlite` (intégré à Node 22, sans dépendance) est
l'option de repli si un jour la volumétrie l'exige — décision repoussée.

Les fichiers par utilisateur sont **supprimés avec le compte** (à brancher sur
`POST /api/admin/user/delete`, comme `state-<uid>.json`).

## 3. Modèle de données

### 3.1 Nutrition (`nutrition-<uid>.json`) — Phase 1

```js
{
  v: 1,
  profile: { heightCm: 178 | null },              // taille → IMC avec le dernier poids du state
  goals:   { kcal: 2400, protein: 160, carbs: 260, fat: 75 } | null,   // grammes / jour
  foods: [                                         // aliments perso (ou figés depuis OFF)
    { id, name, brand?, barcode?, source: 'manual'|'off',
      per100: { kcal, protein, carbs, fat, fiber?, sugar?, salt? },
      serving?: { label, grams }, createdAt, updatedAt }
  ],
  log: [                                           // une ligne = un aliment mangé
    { id, d: 'YYYY-MM-DD', meal: 'breakfast'|'lunch'|'dinner'|'snack',
      name, brand?, barcode?, source, grams,
      per100: { … },                               // copie figée : l'entrée ne bouge pas si OFF change
      createdAt, updatedAt }
  ]
}
```

Les macros d'une ligne sont **calculées** (`per100 × grams / 100`), jamais stockées : une seule
source de vérité, pas d'incohérence possible. Le calcul vit dans un module pur testé
(`frontend/src/lib/nutrition.js`, miroir de la validation serveur `api/nutrition.js`).

Poids et mensurations : **inchangés** (`state.bodyweight[]`, `state.measurements[]`). La vue
nutrition les lit depuis le store pour l'IMC et les courbes.

### 3.2 Santé importée (`health-<uid>.json`) — Phase 2

```js
{ samples: [ { id, type: 'steps'|'weight'|'restingHr'|'sleepMin'|'workout',
               d, value, unit, source: 'apple-health'|'health-connect'|'fit'|'gpx'|'strava',
               extId?, createdAt } ] }
```

Dédoublonnage par `(source, type, d, extId)`. Un poids importé est **proposé** pour
`state.bodyweight` côté client (le client reste l'auteur du state, la fusion reste la sienne).

### 3.3 Intégrations (`integrations.json`) — Phase 2

```js
{ webhooks: [ { id, uid, tokenHash: sha256(token), label, createdAt, lastUsedAt, revokedAt } ],
  strava:   [ { uid, athleteId, refreshTokenEnc, scope, linkedAt } ] }
```

- Jeton webhook : 32 octets aléatoires, montré **une seule fois** à la création, stocké haché.
  Révocable, plusieurs par utilisateur (un par Raccourci). Comparaison en temps constant.
- `POST /api/hooks/apple-health` : `Authorization: Bearer <token>`, corps JSON borné (64 ko),
  schéma strict, rate limit par jeton **et** par adresse (fenêtre `rate-limit.js` existante).
- Tokens Strava chiffrés (AES-256-GCM, clé dérivée de `DATA_DIR/secret` via HKDF).

### 3.4 Social (`social.json`) — Phase 3

```js
{ groups:  [ { id, name, ownerUid, inviteCodeHash, createdAt } ],
  members: [ { groupId, uid, role: 'owner'|'member', joinedAt,
               share: { oneRm: false, volume: false, streak: false, regularity: false } } ] }
```

- **Opt-in par métrique et par groupe**, tout à `false` par défaut.
- Leaderboard calculé à la demande depuis `state-<uid>.json` des membres qui partagent la
  métrique : 1RM estimé (Epley `w × (1 + r/30)`, déjà dans `lib/onerm.js`), volume hebdo,
  streak, régularité (séances / semaine sur 4 semaines).
- Toute donnée `source: 'strava'` est **exclue au niveau de la fonction d'agrégation**, testée.
- Un membre ne voit que les groupes dont il est membre (404 sinon).

### 3.5 Coach IA

Le Coach openGym existe déjà avec des providers abstraits (`api/coach/core/providers.js`) :
**Gemini** (free tier, défaut Biscotos), et « OpenAI-compatible » qui couvre **Groq** et
**OpenRouter** par simple `baseUrl`. Il pseudonymise déjà (HMAC `coach/handle.js`, jamais
l'uid, ni nom ni e-mail). À ajouter :
- la nutrition (moyennes kcal/macros sur 7 jours, pas le détail des repas) dans le payload ;
- un filtre `source !== 'strava'` à l'entrée de `payload.build` + test ;
- un bilan hebdomadaire (le « review » cadencé existe déjà : `coach/cadence.js`).

## 4. Open Food Facts

- **Appels faits par le serveur**, pas par le navigateur :
  - OFF demande un `User-Agent` identifiant l'application (`Biscotos/<version> (+repo URL)`),
    qu'un navigateur ne peut pas poser ;
  - l'adresse IP et les recherches de l'utilisateur ne partent pas chez un tiers ;
  - cache partagé (les produits sont publics) → moins d'appels, rapide en salle ;
  - la CSP du front pourra rester `connect-src 'self'`.
- Routes : `GET /api/food/search?q=` et `GET /api/food/barcode/<8–14 chiffres>`, **authentifiées**
  (pas de proxy ouvert), **rate-limitées par utilisateur**, timeout 8 s, réponse **normalisée et
  bornée** (on ne relaie jamais le JSON brut d'OFF).
- Mode invité (sans serveur) : saisie manuelle uniquement.

## 5. Sécurité transverse

| Exigence | Mise en œuvre |
|---|---|
| Pas d'IDOR | `uid` de session, lookup `id` **dans** le fichier de l'utilisateur ; test « l'utilisateur B reçoit 404 sur l'entrée de A » **par route** |
| Validation | Fonctions pures `validate*` côté serveur (types, bornes, longueurs, dates), rejet `400` ; champs inconnus ignorés |
| Rate limiting | `createWindow` existant : OFF (par uid), webhook (par jeton + adresse) |
| En-têtes | Phase dédiée : CSP complète (hash du script inline), `Permissions-Policy` (caméra = self). HSTS au niveau du tunnel |
| Logs | Jamais de corps, de jeton, de nom d'aliment ni de valeur de santé dans les logs |
| Secrets | `.env` uniquement ; `.env.example` à jour avec des valeurs factices |

## 6. Découpage en phases

| Phase | Contenu | Statut |
|---|---|---|
| 0 | Sécurité du dépôt, audit, rebranding, fondations design | cette nuit |
| **1** | **Nutrition** (journal, macros, objectifs, OFF recherche + code-barres, taille/IMC) | cette nuit |
| 2 | Webhook Apple Santé + `APPLE_HEALTH.md` ; puis Health Connect (plugin Capacitor), import `.fit`/`.gpx` | webhook si la phase 1 est stable |
| 3 | Social : groupes, invitations, opt-in, leaderboards | à venir |
| 4 | Coach IA : nutrition dans le payload, bilan hebdo, Gemini par défaut, filtre Strava | à venir |
| 5 | Strava (optionnel, isolé, jamais leaderboard ni IA) | à venir |
| 6 | Polish design global de l'existant, CSP stricte | à venir |
