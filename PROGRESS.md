# Biscotos — compte rendu

## Matin du 15 octobre — décisions appliquées (`docs/QUESTIONS.md`)

- Q2 : les 10 tests hérités passent (fixtures datées par rapport à aujourd'hui) → **api 668 ✅, 0 échec**.
- Q4 : image web **sans** les médias Gym visual (`EXERCISE_MEDIA=0`) ; `docker-compose.yml` construit
  toujours Biscotos depuis ce dépôt au lieu de tirer les images openGym.
- Q5 : textes visibles renommés dans les 18 langues ; mises à jour Android vérifiées sur les releases
  de Biscotos (plus celles d'openGym) ; plus de lien vers l'APK openGym.
- Q6 : export / import / effacement des données nutrition et santé (+ tests d'autorisation).
- Q7 : poids Apple Santé proposé dans la carte « Poids corporel » de l'Accueil.
- Q1 : branche publiée en `biscotos-dev`.
- Frontend : **5 117 ✅**. Docker indisponible dans la session : l'image n'a pas été construite ici
  (le build Vite avec le flag l'a été) → à vérifier avec `docker compose up -d --build`.

---

# Session de nuit (14 → 15 octobre 2026)

Branche : `claude/tender-cannon-hq3si3` (voir `docs/QUESTIONS.md` Q1 pour `biscotos-dev`).
Aucun push sur `main`, aucun `--force`, aucun `--no-verify`, aucune réécriture d'historique.

## ✅ Fait

| # | Étape du brief | Commit | Livrables |
|---|---|---|---|
| 0 | Sécurité 2.1 | `3c5f49b5` | identité git noreply, hook gitleaks versionné (`.githooks/`), audit de l'historique complet, `.gitignore` durci → `docs/SECURITY_AUDIT.md` |
| 2 | Audit | `2543962a` | `docs/AUDIT.md` (openGym est **déjà multi-utilisateur**) |
| 3 | Architecture | `31edbd60` | `docs/ARCHITECTURE.md` (modèle de données, choix, phases 1→6) |
| 4 | Rebranding | `c3d49fd7` | titre, manifest, écrans d'accueil/connexion, nom passkey, footer « Biscotos · basé sur openGym » + lien source (AGPL §13), README ; l'ancien README → `docs/OPENGYM_README.md` |
| 5 | Fondations design | `b6b7f699` | direction « Nocturne de stade », tokens `--bx-*`, sombre + clair, système d'animation centralisé avec `prefers-reduced-motion` → `docs/DESIGN.md` |
| 6 | **Phase 1 Nutrition** | `5b02a64d`, `41f0aa65` | journal par repas, macros P/G/L/kcal, objectifs, taille + IMC, recherche et **code-barres** Open Food Facts (via le serveur), aliments perso, saisie manuelle, graphe 7 jours, 18 langues |
| 7 | Webhook Apple Santé | `8cf99eb9`, `c5e34c66` | jetons hachés révocables, `POST /api/hooks/apple-health`, feuille de gestion, `docs/APPLE_HEALTH.md` |

### Tests

| Suite | Avant | Après |
|---|---|---|
| frontend (vitest) | 5 060 ✅ | **5 100 ✅** (0 échec) |
| api (`node --test`) | 583 ✅ / 10 ❌ | 647 ✅ / 10 ❌ hérités — corrigés le matin (Q2) |
| mcp | 94 ✅ | inchangé |
| `check-locales`, `check-source-strings --strict`, `build-api-docs --check`, `npm run build` | — | ✅ |

**Un test d'autorisation par route** ajoutée (15 routes) : sans session → 401 ; l'id d'un autre
profil → 404 indiscernable d'un id inexistant, fichier de l'autre profil inchangé à l'octet près ;
un jeton webhook n'est une session nulle part ; CSRF refusé ; rate limiting vérifié ; aucune valeur
dans les logs (`api/test/nutrition-routes.test.js`, `api/test/health-routes.test.js`).

Vérifié aussi **dans un vrai navigateur** (Chromium headless, API + Vite + faux serveur OFF) :
objectifs, recherche, portion, scan par chiffres, création de jeton, envoi type Raccourci,
affichage des mesures reçues — 0 erreur console. Défauts trouvés et corrigés ainsi : en-tête qui
débordait à 390 px, feuille modale sous la barre d'onglets, contraste du Volt en thème clair.

## ❌ Pas fait (volontairement, hors périmètre de la nuit)

- Social / leaderboards, Strava, Health Connect, import `.fit`/`.gpx`, coach IA nutrition
  (phases 3–5 de `docs/ARCHITECTURE.md`).
- Polish design des écrans hérités d'openGym (la couche `.bx` ne touche aucun écran existant).
- CSP stricte (il faut un hash pour le script inline d'`index.html` et tester l'app Capacitor).
- Poids Apple Santé → courbe de poids (Q7), export/RAZ des données nutrition (Q6).

## ⚠️ Bloquants / à vérifier

1. **Open Food Facts n'a pas pu être appelé en vrai** : le réseau de la session cloud le bloque
   (403 du proxy). Le client suit l'API documentée (v2 produit, `cgi/search.pl`) et est testé
   contre un faux serveur. **À vérifier demain** (commande ci-dessous).
2. **Scan code-barres dans l'app Android/iOS** (ML Kit) non testé sur appareil — la PWA Chrome
   Android utilise `BarcodeDetector`, Safari iOS n'en a pas → saisie des chiffres.
3. 10 tests api hérités en échec (Q2) — sans lien avec Biscotos, mais la CI GitHub sera rouge.
4. Questions ouvertes : `docs/QUESTIONS.md` (Q1 branche, Q2 tests, Q3 workflows hérités,
   **Q4 licence des médias Gym visual — à lire avant tout déploiement**, Q5 rebranding partiel,
   Q6 sauvegardes, Q7 poids importé).

## 🔐 Sécurité

- Historique scanné (1 448 commits) : **aucun secret**. Un faux positif (clé publique VAPID
  factice dans un test) mis en liste blanche par empreinte exacte.
- Chaque commit de la nuit est passé par le hook gitleaks (« no leaks found » à chaque fois).
- Aucune donnée personnelle réelle : toutes les fixtures sont fictives (« Alex Demo », « Sam Demo »,
  codes-barres `3000000000xxx`), aucun domaine, IP ou identifiant d'infra dans le code.
- Les nouveaux fichiers de données (`nutrition-*.json`, `health-*.json`, `integrations.json`) sont
  en `0600`, sous `data/` (ignoré par git), supprimés avec le compte.
- Point d'attention trouvé : **licence des médias d'exercices** (Q4).

## 🧪 Tester demain matin

```bash
git fetch origin claude/tender-cannon-hq3si3 && git checkout claude/tender-cannon-hq3si3
git config core.hooksPath .githooks          # active le hook gitleaks (gitleaks requis)

# 1. Tests
(cd frontend && npm ci && npm test && node scripts/check-locales.mjs)
(cd api && npm ci --omit=optional && npm test)   # attendu : 10 échecs hérités (Q2), rien d'autre

# 2. Open Food Facts en vrai (depuis ta machine, qui a internet)
cd api && node -e "import('./nutrition/off.js').then(async m => {
  const off = m.createOff({ userAgent: 'Biscotos/dev (+https://github.com/Hugo-Mllr/Biscotos)' });
  console.log(await off.barcode('3017620422003'));
  console.log((await off.search('skyr')).slice(0, 3));
})"; cd ..

# 3. L'app complète
cp .env.example .env
docker compose up -d --build                  # http://localhost:8080
#   → crée un compte (passkey), Accueil → carte « Nutrition »
#   → « Ajouter un aliment » : recherche « skyr », ou « Scanner un code-barres »
#   → carte « Corps » → « Apple Santé » → « Créer un jeton », puis :
export BISCOTOS_HOOK_TOKEN=bxh_…               # le jeton affiché
curl -X POST http://localhost:8080/api/hooks/apple-health \
  -H "Authorization: Bearer $BISCOTOS_HOOK_TOKEN" -H "Content-Type: application/json" \
  -d "{\"samples\":[{\"type\":\"steps\",\"date\":\"$(date +%F)\",\"value\":1234}]}"

# 4. Avant tout push : scan de la branche
gitleaks git --log-opts="origin/main..HEAD" --redact . && gitleaks dir --redact .
```
