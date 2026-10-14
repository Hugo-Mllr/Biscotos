# Questions ouvertes pour Hugo

Décisions ambiguës ou irréversibles que je n'ai **pas** prises seul. Chaque entrée : contexte,
options, ce que j'ai fait en attendant.

## Q1 — Nom de la branche de travail

Le brief demande `biscotos-dev`. La session cloud m'impose de développer et pousser sur
`claude/tender-cannon-hq3si3` (et interdit de pousser ailleurs sans permission explicite de
l'environnement). **En attendant** : tout le travail est sur `claude/tender-cannon-hq3si3`,
jamais sur `main`. Pour la renommer côté GitHub :

```bash
git fetch origin claude/tender-cannon-hq3si3
git push origin origin/claude/tender-cannon-hq3si3:refs/heads/biscotos-dev
```

## Q2 — 10 tests api pré-existants en échec (dates codées en dur)

`api/test/helpers.mjs` → `sampleState()` date les séances au `2026-07-20`. Le coach IA ne
regarde qu'une fenêtre récente : depuis mi-octobre 2026 ces fixtures sont « trop vieilles » et
10 tests coach échouent (sur `main` aussi, avant toute modif Biscotos). Options :

1. Rendre les dates relatives à aujourd'hui dans le helper (petit diff, mais touche des tests
   upstream que je n'ai pas écrits — 2 des 10 restent rouges et demandent une analyse plus fine).
2. Attendre/porter le correctif upstream openGym.

**En attendant** : rien modifié ; règle « aucun nouvel échec » vs la liste de
`docs/SECURITY_AUDIT.md`.

## Q3 — Workflows GitHub hérités d'openGym

`.github/workflows/` contient `mirror.yml` (push vers le GitLab **d'openGym**), `docker-publish.yml`,
`pages.yml`, `cla.yml`, `cla-issue.yml`, `catalogue.yml`. Sans les secrets d'upstream ils échouent
ou ne font rien d'utile, mais `cla*.yml` peut commenter sur les PR de ton dépôt. **Supprimer ou
désactiver des workflows** est une décision qui t'appartient : je n'y ai pas touché. Suggestion :
garder `test.yml`, désactiver les autres dans Settings → Actions (réversible, sans commit).

## Q4 — ⚠️ Licence des médias d'exercices (Gym visual) — à trancher par toi

`NOTICE.md` : les images/animations d'exercices sont licenciées **à openGym uniquement**
(« provided strictly for use within the openGym application … Third parties have no rights to
reuse … A commercial fork, or any other use, needs its own licence from gymvisual.com »).
Biscotos est un fork non commercial, mais rebrandé : il n'est pas évident qu'il reste couvert.
Le service `media` de `docker-compose.yml` télécharge ces médias depuis le jeu de données
d'openGym au démarrage.

Je n'ai **rien changé** (pas de suppression, texte d'attribution conservé mot pour mot dans
Réglages). Options : (a) demander à Duarte Santos / Gym visual si un fork privé entre amis est
couvert ; (b) désactiver le service `media` (l'app fonctionne sans images, cf. `MEDIA_*` dans
`.env.example`) ; (c) acheter une licence. Je recommande (a) avant tout déploiement.

## Q5 — Rebranding partiel (volontaire)

Renommés : titre, manifest PWA, écran de connexion, accueil, onboarding mobile, footer
(« Biscotos v… · basé sur openGym », lien source → ce dépôt, conformément à l'AGPL §13),
`RP_NAME` par défaut (nom affiché par la passkey), README.

**Non renommés** (≈ 600 occurrences) : les chaînes traduites qui mentionnent « openGym » dans
18 langues, le dossier `Documents/openGym` (renommer casserait les sauvegardes auto existantes),
le format des fichiers de sauvegarde / plans (`not an openGym backup`), l'ID Android
`ch.duartesantos.opengym`, le vérificateur de mises à jour (pointe vers les releases d'openGym),
le champ fabricant des exports `.fit`. Changer l'ID d'application Android ou le dossier de
sauvegarde est **irréversible pour les utilisateurs existants** → à décider par toi, avec un plan
de migration. Le reste des chaînes peut se faire dans la phase de polish.
