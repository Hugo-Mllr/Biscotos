# Mission Biscotos — brief pour Claude Code

> Lis ce fichier en entier avant de toucher au code. La section SÉCURITÉ prime sur toutes les autres.
> En cas de conflit entre « aller vite » et « sécurité », la sécurité gagne toujours.

---

## 1. Contexte

- Je suis Hugo, étudiant en cybersécurité. Projet perso : **Biscotos**, une plateforme sport + nutrition, partagée avec quelques amis (< 15 utilisateurs).
- Dépôt : `https://github.com/Hugo-Mllr/Biscotos`. C'est un **fork d'openGym** (DuarteSantos8/openGym, licence **AGPL-3.0**). Le code actuel = openGym tel quel.
- **Le dépôt est PUBLIC.** Tout ce qui est commité est lisible par n'importe qui, pour toujours (même après suppression, via l'historique).
- Hébergement cible : mon homelab (Docker), exposé via un tunnel sur un sous-domaine de mon domaine perso. Ces valeurs viennent **uniquement** de variables d'environnement, jamais du code.
- Budget : 0 €. Uniquement services et API gratuits.

---

## 2. SÉCURITÉ — règles non négociables

### 2.1 Avant le premier commit (à faire en tout premier)

1. Vérifie l'identité git locale : `git config user.email`. Si ce n'est pas une adresse `@users.noreply.github.com`, **ARRÊTE-TOI** : n'écris aucun commit, note-le dans `docs/QUESTIONS.md` et attends-moi.
2. Installe un scanner de secrets en pre-commit : **gitleaks** (hook `pre-commit` ou `.git/hooks/pre-commit`). Le hook doit bloquer tout commit qui contient un secret.
3. Lance `gitleaks detect` sur l'historique existant et consigne le résultat dans `docs/SECURITY_AUDIT.md`.
4. Durcis le `.gitignore` : `.env`, `.env.*` (sauf `.env.example`), dossiers de données / bases SQLite / uploads / backups, `*.pem`, `*.key`, `*.p12`, `*.keystore`, `*.jks`, `google-services.json`, `GoogleService-Info.plist`, fichiers d'export santé (`*.fit`, `*.gpx`, `*.xml` d'export Apple Santé hors fixtures synthétiques), logs, `.DS_Store`, configs locales d'IDE.

### 2.2 Ce qui ne doit JAMAIS apparaître dans un commit

- Clés API, tokens, mots de passe, secrets de session, clés de signature (APK inclus), cookies.
- **Toute donnée personnelle réelle** : nom, email, téléphone, poids, mensurations, séances, données de santé, photos. Les fixtures, seeds, tests et captures d'écran utilisent des **données 100 % fictives** (ex. « Alex Demo », `demo@example.com`).
- Infos d'infrastructure : IP (y compris `192.168.x.x`), noms d'hôtes, domaine perso, ID de tunnel, ports internes spécifiques à mon réseau.
- Logs, dumps de base de données, fichiers de debug.

### 2.3 Avant CHAQUE commit

1. `git diff --staged` : relis réellement ce que tu ajoutes.
2. Le hook gitleaks doit passer. **Ne contourne jamais** un hook (`--no-verify` interdit).
3. Les tests existants passent.

### 2.4 Si un secret ou une donnée perso a déjà été commité

- **N'essaie pas de réécrire l'historique toi-même** (pas de `filter-repo`, pas de `push --force`).
- Arrête de pousser, documente précisément le problème dans `docs/QUESTIONS.md` (sans recopier le secret) et passe à une autre tâche locale.

### 2.5 Push

- Tu ne pushes **jamais** sur `main`. Pas de `--force`.
- Tu ne pushes la branche `biscotos-dev` qu'après un `gitleaks detect` propre sur la branche entière.
- Dans le doute → tu ne pushes pas, tu commites seulement en local.

### 2.6 Sécurité applicative (données de santé = données sensibles)

- Auth solide : conserve les passkeys d'openGym.
- Cloisonnement strict entre utilisateurs : chaque endpoint vérifie que la ressource appartient à l'utilisateur (pas d'IDOR). **Un test d'autorisation par endpoint.**
- Validation de toutes les entrées, rate limiting sur les endpoints exposés (webhook surtout), en-têtes de sécurité (CSP, HSTS, etc.).
- Aucun secret ni donnée perso dans les logs.
- Les prompts envoyés à l'IA : données minimales, pseudonymisées (pas de nom, pas d'email).
- Tous les secrets dans `.env`, avec un `.env.example` à jour (valeurs factices uniquement).

### 2.7 Licence

- AGPL-3.0 : garde `LICENSE` et l'attribution à openGym (README + footer). Le code reste public, c'est conforme.

---

## 3. Vision produit (cible finale — PAS tout pour cette nuit)

1. **Entraînement** : existant openGym (séances, routines, progression, graphes, carte musculaire).
2. **Nutrition** : journal alimentaire, macros (P/G/L/kcal), objectifs, recherche + scan de code-barres via l'API Open Food Facts, suivi poids / taille / mensurations avec courbes.
3. **Social** : groupe d'amis, leaderboards (1RM estimé Epley, volume hebdo, streaks, régularité), basés **uniquement** sur les données saisies dans l'app. Les données des autres sont visibles uniquement si l'utilisateur a choisi de les partager (opt-in).
4. **Intégrations** :
   - Apple Santé : endpoint webhook authentifié (token par utilisateur, révocable) alimenté par un Raccourci iOS (poids, pas, séances, FC repos, sommeil).
   - Android : Health Connect via l'app Capacitor existante.
   - Import de fichiers `.fit` / `.gpx` (montres).
   - Strava : OPTIONNEL et isolé. Contraintes de leur API : données affichées uniquement à leur propriétaire, **jamais** dans le leaderboard, **jamais** envoyées à une IA. Marque-les `source=strava` et fais respecter ces règles dans le code (avec tests).
5. **Coach IA** : analyse des données (hors Strava) via une API LLM gratuite (Gemini free tier par défaut). Provider abstrait pour basculer sur Groq ou OpenRouter. Bilan hebdo + conseils. Clé en variable d'environnement.
6. **Mobile** : PWA installable (manifest, service worker, offline basique) + l'APK Capacitor existant.

---

## 4. Direction design — un site VRAIMENT stylé

- Utilise la skill **frontend-design** si elle est disponible.
- Je veux une identité forte et moderne, pas un look « template IA ». Propose une direction esthétique nommée (ex. sport premium sombre, néons sobres, typographie massive, chiffres mis en avant comme sur un tableau de score).
- Mets en place dès maintenant les fondations : **design tokens** (couleurs, typo, espacements, rayons, ombres), dark mode par défaut + light mode, **système d'animation centralisé** (durées, easings, `prefers-reduced-motion` respecté).
- Animations utiles prioritaires : transitions de page, compteurs qui défilent, graphes qui se dessinent, feedback de validation de série et de PR, micro-interactions sur boutons/cartes.
- Mobile-first : l'usage principal se fait au téléphone, en salle.
- Cette nuit : les fondations + la direction appliquée aux nouveaux écrans. Le polish global de l'existant viendra dans une phase dédiée.
- Rédige `docs/DESIGN.md` : direction choisie, tokens, règles d'animation.

---

## 5. Plan pour cette nuit (travail autonome, je dors)

0. Section 2.1 complète (identité git, gitleaks, audit de l'historique, `.gitignore`).
1. Crée la branche `biscotos-dev`. Commits petits, fréquents, messages clairs (Conventional Commits).
2. **Audit** du repo (stack, stockage, auth, multi-utilisateur ou non) → `docs/AUDIT.md`.
3. **Architecture** → `docs/ARCHITECTURE.md` : modèle de données cible (nutrition, poids, amis, leaderboard, intégrations, IA), choix techniques justifiés, découpage en phases. Si openGym n'est pas multi-utilisateur, propose la migration la moins invasive.
4. **Rebranding** openGym → Biscotos (nom, titre, manifest, README), en gardant l'attribution.
5. **Fondations design** (section 4) + `docs/DESIGN.md`.
6. **Phase 1** : module Nutrition + suivi poids/taille (Open Food Facts), intégré à l'UI avec la nouvelle direction, avec tests.
7. Uniquement si la phase 1 est finie, testée et stable : webhook Apple Santé + `docs/APPLE_HEALTH.md` (guide du Raccourci iOS). Rien au-delà.

### Règles de conduite

- Ne casse jamais l'existant : lance les tests avant chaque commit.
- Décision ambiguë ou irréversible → ne la prends pas, note-la dans `docs/QUESTIONS.md` et continue sur autre chose.
- Ne supprime aucune donnée ni aucun fichier existant sans le documenter.
- Fin de session → `PROGRESS.md` : fait / pas fait / bloquants / problèmes de sécurité rencontrés / comment tester demain matin (commandes exactes).
