# Biscotos

**Entraînement, nutrition et suivi corporel — auto-hébergé, entre amis.**

Biscotos est une plateforme sport + nutrition pour un petit groupe (< 15 personnes), hébergée
sur un homelab. Pas de compte tiers, pas de télémétrie : vos données restent dans un dossier
`./data` que vous possédez.

> Biscotos est un **fork d'[openGym](https://github.com/DuarteSantos8/openGym)** par
> Duarte Santos et ses contributeurs, sous licence **GNU AGPL-3.0-or-later**. Tout le socle
> entraînement (séances, routines, progression, graphes, carte musculaire, passkeys, PWA,
> app Capacitor, coach IA) vient d'openGym. Le README d'origine est conservé dans
> [`docs/OPENGYM_README.md`](docs/OPENGYM_README.md).

## Ce que Biscotos ajoute

| Module | État |
|---|---|
| Entraînement (openGym) | ✅ hérité |
| Poids corporel, mensurations | ✅ hérité |
| **Nutrition** : journal, macros (P/G/L/kcal), objectifs, recherche et code-barres [Open Food Facts](https://world.openfoodfacts.org), taille / IMC | 🚧 phase 1 |
| Webhook Apple Santé (Raccourci iOS) | ⏳ phase 2 |
| Amis, leaderboards opt-in | ⏳ phase 3 |
| Coach IA (Gemini free tier par défaut) | ⏳ phase 4 — le moteur openGym existe déjà |

Feuille de route détaillée : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Direction visuelle : [`docs/DESIGN.md`](docs/DESIGN.md).

## Démarrer

```bash
cp .env.example .env          # valeurs factices : à adapter (RP_ID, ORIGIN…)
docker compose up -d --build  # http://localhost:8080
```

Déploiement réel derrière un tunnel HTTPS : [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).
Le domaine, l'adresse et tout identifiant d'infrastructure viennent **uniquement** de `.env`.

## Voir le site en local, sans Docker

Il faut **Node 22** (`node -v`). Deux terminaux, depuis la racine du dépôt :

```bash
# Terminal 1 — l'API (données dans ./data, ignoré par git)
cd api && npm ci --omit=optional
DATA_DIR=../data ORIGIN=http://localhost:5173 RP_ID=localhost node server.js

# Terminal 2 — l'interface, avec rechargement à chaud
cd frontend && npm ci
API_ORIGIN=http://localhost:5173 VITE_EXERCISE_MEDIA=0 npm run dev
```

Sous **Windows (PowerShell)**, les mêmes commandes, une ligne à la fois :

```powershell
# Terminal 1 — l'API
cd api
npm ci --omit=optional
$env:DATA_DIR="../data"; $env:ORIGIN="http://localhost:5173"; $env:RP_ID="localhost"
node server.js

# Terminal 2 — l'interface
cd frontend
npm ci --ignore-scripts
$env:API_ORIGIN="http://localhost:5173"; $env:VITE_EXERCISE_MEDIA="0"
npm run dev
```

Ouvre **http://localhost:5173** → « Créer un nouveau profil » → « Créer une passkey » (Touch ID,
Windows Hello ou le gestionnaire de mots de passe de ton navigateur).

- `ORIGIN` et `API_ORIGIN` doivent être **l'adresse exacte de la page** : une passkey est liée à
  son origine, sinon l'inscription échoue.
- `VITE_EXERCISE_MEDIA=0` montre l'app comme en production (sans les animations Gym visual) ;
  sans ce réglage, le serveur de dev les sert depuis `catalogue/media`.
- Sur ton téléphone, même réseau : les passkeys exigent HTTPS hors `localhost`, donc passe par
  « Continuer sans compte » pour un aperçu, ou attends le déploiement sur le homelab.

## Développer

```bash
git config core.hooksPath .githooks   # hook gitleaks obligatoire (voir docs/SECURITY_AUDIT.md)
cd frontend && npm install && npm run dev
cd frontend && npm test
cd api && npm test
```

## Sécurité

Le dépôt est **public**. Règles, audit et garde-fous : [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md).
Signaler une faille : voir [`SECURITY.md`](SECURITY.md) (politique héritée d'openGym ;
pour Biscotos, contactez le mainteneur du fork via GitHub).

## Licence et attributions

- Code : **GNU AGPL-3.0-or-later** ([LICENSE](LICENSE)) — © openGym contributors, et les
  modifications Biscotos © Hugo-Mllr. Conformément à l'AGPL §13, l'application affiche un lien
  vers le code source de la version qui tourne.
- Composants tiers et médias d'exercices : [NOTICE.md](NOTICE.md). Les animations d'exercices
  (Gym visual) ont une licence **propre, distincte de l'AGPL** — voir `docs/QUESTIONS.md`.
- Données alimentaires : © Open Food Facts contributors, sous licence
  [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
