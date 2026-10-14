# Biscotos — audit du dépôt (base openGym v1.4.1)

> État du code au fork (commit `e348fc17`), avant toute fonctionnalité Biscotos.
> Objectif : savoir sur quoi on construit, et ce qui manque pour la vision Biscotos.

## 1. Stack

| Couche | Techno | Notes |
|---|---|---|
| Frontend | React 19 + Vite 8, `react-router-dom` 7, Zustand 5 | PWA (`public/manifest.json`, `public/sw.js`), JS sans TypeScript, CSS maison (pas de Tailwind) |
| Mobile | Capacitor 7 (Android + iOS) | Même build web dans une WebView ; ML Kit pour le scan de codes |
| API | Node 22, `node:http` pur, **un seul fichier** `api/server.js` (~2 700 lignes) | 2 dépendances : `@simplewebauthn/server`, `web-push` |
| Stockage | Fichiers JSON sous `DATA_DIR` | `db.json` (comptes, passkeys, abonnements push, invitations) + `state-<uid>.json` (un document par utilisateur) |
| Coach IA | `api/coach/` | Providers HTTP déjà abstraits : Anthropic, OpenAI, **Gemini**, « OpenAI-compatible » (→ **Groq / OpenRouter**) |
| MCP | `mcp/` | Pont stdio en lecture seule vers `DATA_DIR` |
| Déploiement | `docker-compose.yml` (api + web nginx + media), Helm, Kubernetes, Nix | nginx sert le front et proxifie `/api` → même origine (requis pour les passkeys) |
| Tests | vitest (front, 5 060 tests), `node --test` (api, 593), mcp (95) | CI GitHub Actions sur Node 22 |

Dépendances : la règle upstream « dependency-light » est stricte (front : React + Router +
Zustand ; API : 2 deps). **Biscotos la conserve** — aucune dépendance ajoutée cette nuit.

## 2. Multi-utilisateur : oui

openGym est **déjà multi-utilisateur** : chaque compte a un `uid`, un document d'état propre
(`state-<uid>.json`), et chaque route lit l'utilisateur **depuis la session** (`readSession(req)`),
jamais depuis un paramètre. Il n'y a donc pas de migration multi-utilisateur à faire.

Conséquence pour l'IDOR : les routes existantes n'acceptent **aucun identifiant de ressource
appartenant à un autre utilisateur** — `GET/PUT /api/data` adresse toujours le document de
l'appelant. Seules les routes `/api/admin/*` prennent un `uid` en paramètre, et elles sont
gardées par `requireAdmin` (403 + entrée d'audit sinon).

## 3. Authentification et session

- **Passkeys WebAuthn** (`@simplewebauthn/server`), `RP_ID` / `ORIGIN` en variables d'env.
  Challenges typés par cérémonie (inscription / connexion / ajout de passkey / lien d'appareil),
  TTL 5 min, store borné à 20 000 entrées.
- Mot de passe **optionnel** (`PASSWORD_LOGIN`, off par défaut), scrypt, throttling par adresse
  et par compte (`api/rate-limit.js`).
- Cookie de session signé HMAC (`DATA_DIR/secret`, 32 octets aléatoires générés au premier
  boot, `0600`) : `__Host-gymsid` en HTTPS, `HttpOnly; Secure; SameSite=Lax`, 90 jours par défaut
  (`SESSION_DAYS`), version de session pour « déconnecter partout ».
- App mobile appairée : même jeton en `Authorization: Bearer`, obtenu via un code d'appairage
  one-shot de 5 min.
- Comptes désactivés refusés partout ; premier utilisateur admin seulement si `FIRST_USER_ADMIN`.

## 4. Défenses applicatives existantes

| Contrôle | État |
|---|---|
| CSRF | ✅ `Sec-Fetch-Site` puis repli sur `Origin` ; exemptions limitées aux routes qui portent leur propre preuve |
| CORS | Origine reflétée **sans** `Allow-Credentials` (seulement utile au Bearer mobile) |
| Taille des corps | ✅ 5 Mo max, délai de corps 5 min |
| Écritures | ✅ atomiques (temp + `fsync` + rename), sauvegarde `db.json.bak`, conflit optimiste (`baseRev` → 409) |
| Rate limiting | ⚠️ **uniquement** routes d'auth par mot de passe, upload média, journal d'audit. Rien sur les routes « métier » — normal tant qu'elles n'appellent pas de service externe |
| En-têtes HTTP | ⚠️ nginx : `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy same-origin`, CSP **réduite à `frame-ancestors 'none'`**. Pas de HSTS (laissé au reverse proxy, cf. `SECURITY.md`) |
| Logs | ✅ audit JSONL rotatif des événements de connexion/admin ; pas de corps de requête loggé |
| Coach IA | ✅ pseudonyme HMAC par profil (`coach/handle.js`) à la place de l'uid ; payload borné (`coach/core/payload.js`) ; consentement explicite |
| Conteneurs | web : nginx **non-root** (UID 101). api : tourne en root (le Coach dérobe ses privilèges pour ses sous-processus) |

## 5. Ce qui existe déjà et recoupe la vision Biscotos

| Vision Biscotos | Existant openGym |
|---|---|
| Entraînement, routines, progression, graphes, carte musculaire | ✅ complet |
| Poids corporel avec courbe | ✅ `bodyweight[]` + graphe |
| Mensurations | ✅ `measurements[]` (cm canoniques, `lib/measurements.js`, vue `Measurements.jsx`) |
| Taille (height) | ❌ absent |
| Nutrition, macros, Open Food Facts | ❌ absent |
| Scan de code-barres | ⚠️ infra présente pour les cartes de salle (ML Kit sur l'app, `BarcodeDetector`/jsQR en web) mais **QR uniquement** côté web |
| Amis / leaderboards | ❌ absent (le Coach a un module « cohort » admin, sans rapport) |
| Import Apple Santé | ⚠️ import de fichier (`DATA_IMPORTS.md`) ; pas de webhook |
| Coach IA (Gemini, Groq/OpenRouter) | ✅ déjà abstrait — à reconfigurer, pas à réécrire |
| PWA installable | ✅ manifest + service worker |

## 6. Points d'attention pour la suite

1. **Le moteur de synchronisation** (`frontend/src/lib/sync-merge.js` + sa copie serveur
   `api/sync-stamps.js`, avec test de parité) est sophistiqué et a une longue histoire de bugs
   corrigés. Y ajouter des champs est possible mais risqué : pour la nutrition, je choisis un
   **stockage serveur séparé** (cf. `ARCHITECTURE.md`).
2. **Tests api datés en dur** : 10 tests coach échouent depuis mi-octobre 2026 (cf.
   `SECURITY_AUDIT.md` § 5 et `QUESTIONS.md` Q2).
3. **CSP** : seule `frame-ancestors` est posée. Une CSP complète est faisable mais `index.html` contient
   un script inline (sens RTL avant le premier rendu) → il faudra un hash `sha256-…` ; à tester sur
   le build réel et l'app Capacitor : noté pour une phase dédiée, pas fait à l'aveugle cette nuit.
4. **HSTS** : à poser au niveau du tunnel / reverse proxy du homelab (documenté).
5. `.github/workflows/mirror.yml` pousse vers le miroir GitLab d'**openGym** : sans le secret du
   dépôt il échoue simplement, mais il n'a pas de sens pour Biscotos → voir `QUESTIONS.md`.
