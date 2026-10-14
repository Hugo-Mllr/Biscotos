# Biscotos — audit sécurité du dépôt

> Dépôt **public**. Ce document consigne l'état du dépôt vis-à-vis des secrets et des données
> personnelles, et les garde-fous en place. Il ne recopie jamais un secret.

## 1. Identité git

| Contrôle | Résultat |
|---|---|
| `git config user.email` (local au clone) | `81264108+Hugo-Mllr@users.noreply.github.com` ✅ (adresse noreply GitHub) |
| `git config user.name` | `Hugo-Mllr` |

L'identité est configurée **par clone** (`git config`, pas `--global`). À refaire sur chaque
nouvelle machine avant le premier commit.

## 2. Scanner de secrets en pre-commit

- Outil : **gitleaks v8.28.0**, binaire officiel (`gitleaks_8.28.0_linux_x64.tar.gz`) téléchargé
  depuis les releases GitHub, SHA-256 vérifié contre `gitleaks_8.28.0_checksums.txt`
  (`a65b5253…a840eb`).
- Hook **versionné** : `.githooks/pre-commit` → `gitleaks git --pre-commit --staged --redact`.
  - Si gitleaks n'est pas installé, le hook **bloque** le commit (fail-closed).
  - Activation, une fois par clone : `git config core.hooksPath .githooks`
- Vérification effectuée : un faux token GitHub (`ghp_` + 36 caractères aléatoires) placé dans
  un fichier indexé → commit **refusé** (code de sortie 1). Fichier supprimé ensuite, rien commité.
- `--no-verify` est interdit (règle projet).

## 3. Audit de l'historique existant

Le clone cloud était superficiel (*shallow*) : historique complet récupéré avec
`git fetch --unshallow` avant le scan.

```
gitleaks git --log-opts="--all" --redact .
1448 commits scanned · ~89 MB · leaks found: 1
```

| # | Règle | Fichier | Commit | Verdict |
|---|---|---|---|---|
| 1 | `generic-api-key` | `frontend/src/lib/push.test.js:15` | `477fc07f` | **Faux positif.** Constante `KEY` d'un test unitaire, commentée « any base64url string » : une clé **publique** VAPID factice servant à mocker `/api/push/public-key`. Une clé publique VAPID n'est pas un secret, et celle-ci ne correspond à aucun serveur. |

Le faux positif est mis en liste blanche **par empreinte exacte** dans `.gitleaksignore`
(pas de règle générique qui masquerait d'autres fuites). Rescan après allowlist :

```
gitleaks git --log-opts="--all" --redact .   → no leaks found
gitleaks dir --redact .                      → no leaks found
```

### Fichiers sensibles suivis par git

`git ls-files` filtré sur `*.pem *.key *.p12 *.keystore *.jks *.fit *.gpx *.sqlite *.db
google-services.json GoogleService-Info.plist .env*` → seul `.env.example` (valeurs factices).

### Données personnelles dans l'historique

- L'historique contient les **adresses e-mail des auteurs des commits d'openGym** (upstream,
  ~20 contributeurs). Elles sont déjà publiques sur le dépôt d'origine ; ce ne sont pas des
  données de Hugo ni des utilisateurs de Biscotos. Aucune action (et **pas de réécriture
  d'historique**, cf. règle 2.4).
- Aucun dump `data/`, `db.json`, `state-*.json`, export santé ou log trouvé dans l'historique.

## 4. `.gitignore` durci

Ajouts (section « Biscotos hardening ») : `.env.*` (sauf `.env.example`), clés et certificats
(`*.pem *.key *.crt *.p12 *.pfx *.keystore *.jks keystore.properties`),
`google-services.json`, `GoogleService-Info.plist`, `vapid.json`, bases SQLite / `*.db`,
`uploads/`, `backups/`, dumps, `state-*.json`, `db.json`, `audit.log*`, exports santé
(`*.fit *.gpx *.tcx *.csv`, `apple_health_export/`, `export.xml`, `export_cda.xml`) avec une
exception `**/fixtures/**` pour les fixtures **synthétiques**, logs, fichiers OS/IDE.

`*.xml` n'est **pas** ignoré globalement : les ressources Android (`AndroidManifest.xml`,
`res/**`) sont du code source. Vérifié : `git ls-files -ci --exclude-standard` est vide — aucun
fichier suivi n'est devenu ignoré.

## 5. Procédure avant chaque commit

1. `git diff --staged` relu.
2. Hook gitleaks vert (jamais contourné).
3. Tests : `cd frontend && npm test`, `cd api && npm test`, `cd mcp && npm test`.

### Baseline des tests (avant toute modification Biscotos)

| Suite | Résultat |
|---|---|
| frontend (vitest) | 402 fichiers, 5060 tests ✅ |
| mcp | 94 ✅, 1 skip |
| api (`node --test`) | 583 ✅, **10 ❌ pré-existants** |

Les 10 échecs api sont **antérieurs à Biscotos** et liés à la date : les fixtures de
`api/test/helpers.mjs` (`sampleState`) sont datées en dur (`2026-07-20`) et sortent maintenant de
la fenêtre d'analyse du coach IA. Vérifié en décalant temporairement ces dates (non commité) :
8/10 repassent. Détail et proposition dans `docs/QUESTIONS.md`. La règle appliquée pour cette
session est : **aucun nouvel échec** par rapport à cette liste.

## 6. Avant de pousser

```bash
gitleaks git --log-opts="origin/main..HEAD" --redact .   # commits de la branche
gitleaks dir --redact .                                   # arbre de travail
```
