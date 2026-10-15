# Décisions

Questions ouvertes pendant la session de nuit, tranchées par Hugo le 15 octobre 2026.

| # | Sujet | Décision | Fait |
|---|---|---|---|
| Q1 | Branche de travail | Publier en `biscotos-dev` | ✅ poussée |
| Q2 | 10 tests api hérités en échec (dates figées) | Les corriger | ✅ dates relatives à aujourd'hui, 0 échec |
| Q3 | Workflows GitHub hérités d'openGym | Désactivés par Hugo dans *Settings → Actions* | ⏳ à faire par Hugo |
| Q4 | Licence des médias d'exercices (Gym visual, « openGym uniquement ») | Pas de médias pour l'instant | ✅ image web sans médias (`EXERCISE_MEDIA=0`), l'app n'en demande aucun |
| Q5 | Mentions « openGym » restantes | Renommer les textes visibles, garder les identifiants techniques | ✅ 34 chaînes × 18 langues ; `Documents/openGym` et les formats de fichiers inchangés |
| Q6 | Nutrition/santé hors de la sauvegarde de l'app | Export, import et effacement dédiés | ✅ Nutrition → « Mes données nutrition » |
| Q7 | Poids Apple Santé → courbe de poids | Proposé, ajouté sur validation | ✅ Accueil, carte « Poids corporel » |

## Encore ouvert

- **Médias d'exercices** : ils restent présents dans le dépôt (`catalogue/media/`, 216 Mo, hérités
  d'openGym et dans tout l'historique). Biscotos ne les distribue plus, mais ne les a pas supprimés
  du dépôt. Les retirer de l'arbre est possible (`git rm`) ; l'historique public les gardera.
- **Licence** : si tu obtiens l'accord d'openGym / Gym visual, `EXERCISE_MEDIA=1` dans `.env` puis
  `docker compose up -d --build` les remet.
