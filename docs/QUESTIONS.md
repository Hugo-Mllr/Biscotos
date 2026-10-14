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
