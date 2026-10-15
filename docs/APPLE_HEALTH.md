# Apple Santé → Biscotos (Raccourci iOS)

Un Raccourci iOS lit tes données dans l'app **Santé** et les envoie à ton serveur Biscotos, par
exemple chaque soir à 21 h. Pas d'app tierce, pas de compte Apple développeur : juste l'app
**Raccourcis** et un **jeton** propre à ce Raccourci, révocable à tout moment.

> Les captures et exemples de ce guide n'utilisent que des valeurs fictives. Remplace
> `https://biscotos.example.com` par l'adresse de **ton** instance.

## 1. Créer un jeton

1. Dans Biscotos : **Accueil → Nutrition → carte « Corps » → Apple Santé**.
2. Donne un nom (ex. « iPhone »), puis **Créer un jeton**.
3. Copie **l'adresse** et **le jeton** (`bxh_…`). Le jeton n'est affiché **qu'une seule fois** :
   le serveur n'en garde que l'empreinte SHA-256. Perdu ? Révoque-le et crées-en un autre.

Jusqu'à 5 jetons actifs par profil (un par appareil ou par Raccourci).

## 2. Ce que le webhook accepte

`POST /api/hooks/apple-health`, en-tête `Authorization: Bearer bxh_…`, corps JSON :

```json
{
  "samples": [
    { "type": "weight",     "date": "2026-10-14", "value": 75.4, "unit": "kg" },
    { "type": "steps",      "date": "2026-10-14", "value": 9120 },
    { "type": "sleepMin",   "date": "2026-10-14", "value": 7.5, "unit": "h" },
    { "type": "restingHr",  "date": "2026-10-14", "value": 54 },
    { "type": "activeKcal", "date": "2026-10-14", "value": 520 },
    { "type": "workoutMin", "date": "2026-10-14", "value": 45, "id": "seance-matin" }
  ]
}
```

| `type` | Unité | Bornes | Remarque |
|---|---|---|---|
| `weight` | kg (ou `"unit": "lb"`, converti) | 20–400 | une valeur par jour |
| `steps` | nombre | 0–200 000 | total du jour, une valeur par jour |
| `sleepMin` | min (ou `"unit": "h"`, converti) | 0–1 440 | une valeur par jour |
| `restingHr` | bpm | 25–220 | une valeur par jour |
| `activeKcal` | kcal | 0–20 000 | une valeur par jour |
| `workoutMin` | min | 1–1 440 | plusieurs par jour ; `id` facultatif pour dédoublonner |

- `date` : `AAAA-MM-JJ` ou une date ISO 8601 complète (`2026-10-14T21:00:00+02:00`) ; la date
  **telle qu'écrite** est conservée (pas de conversion de fuseau).
- Pour les types « une valeur par jour », un nouvel envoi du même jour **remplace** le précédent :
  le Raccourci peut tourner plusieurs fois par jour sans créer de doublons.
- Réponse : `{ "accepted": 5, "changed": 5, "rejected": 1, "errors": [{ "index": 3, "error": "value out of range" }] }`.
  Les valeurs ne sont **jamais** renvoyées ni journalisées.
- Toute donnée importée porte `source: "apple-health"`.

Test rapide depuis un ordinateur :

```bash
curl -X POST https://biscotos.example.com/api/hooks/apple-health \
  -H "Authorization: Bearer $BISCOTOS_HOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"samples":[{"type":"steps","date":"2026-10-14","value":1234}]}'
```

(Mets le jeton dans une variable d'environnement plutôt que dans la commande, pour qu'il ne
reste pas dans l'historique du shell.)

## 3. Construire le Raccourci

Dans l'app **Raccourcis** → **+** → nomme-le « Biscotos ». Ajoute les actions dans cet ordre
(noms des actions iOS en français, entre parenthèses en anglais).

### a. La date du jour

1. **Date actuelle** (*Current Date*).
2. **Formater la date** (*Format Date*) → Format : **ISO 8601**, *Inclure l'heure* : **désactivé**.
   Renomme la sortie `Jour` (appui long → *Renommer*).

### b. Les valeurs

Pour chaque mesure, une action **Rechercher des échantillons de santé** (*Find Health Samples*) :

| Mesure | Réglages | Puis |
|---|---|---|
| Poids | Type **Poids**, trier par **Date de début**, ordre **Plus récent d'abord**, limite **1** | **Obtenir les détails des échantillons** → *Valeur* → renommer `Poids` |
| Pas | Type **Pas**, *Date de début* **est aujourd'hui** | **Calculer des statistiques** → *Somme* → renommer `Pas` |
| Sommeil | Type **Analyse du sommeil**, *Date de début* **dans les 1 derniers jours**, *Valeur* **est Endormi** | **Obtenir les détails** → *Durée* → **Calculer des statistiques** → *Somme* (en heures) → renommer `Sommeil` |
| FC au repos | Type **Fréquence cardiaque au repos**, plus récent d'abord, limite **1** | **Obtenir les détails** → *Valeur* → renommer `FCRepos` |

Tu peux n'en garder que certaines : envoie seulement les lignes dont tu as besoin.

### c. Le corps JSON

Action **Texte** (*Text*), avec les variables insérées aux bons endroits :

```text
{"samples":[
 {"type":"weight","date":"[Jour]","value":[Poids],"unit":"kg"},
 {"type":"steps","date":"[Jour]","value":[Pas]},
 {"type":"sleepMin","date":"[Jour]","value":[Sommeil],"unit":"h"},
 {"type":"restingHr","date":"[Jour]","value":[FCRepos]}
]}
```

(`[Jour]` etc. = les variables magiques, pas du texte tapé.) Si un nombre sort avec une virgule
(`75,4`), le serveur l'accepte quand il est envoyé **entre guillemets** : `"value":"[Poids]"`.

### d. L'envoi

Action **Obtenir le contenu de l'URL** (*Get Contents of URL*) :

- URL : l'adresse copiée à l'étape 1 (`https://biscotos.example.com/api/hooks/apple-health`)
- Méthode : **POST**
- En-têtes :
  - `Authorization` → `Bearer bxh_…` (ton jeton, précédé de `Bearer ` et d'un espace)
  - `Content-Type` → `application/json`
- Corps de la requête : **Fichier** → la sortie de l'action **Texte**

Optionnel : **Afficher le résultat** à la fin pour voir `accepted` / `rejected` pendant la mise au point.

### e. L'automatisation

**Automatisation** → **+** → **Heure de la journée** → 21:00, **Quotidien** → **Exécuter
immédiatement** → choisis le Raccourci « Biscotos ». iOS demande une fois l'accès aux données
Santé : autorise uniquement les types utilisés.

## 4. Sécurité

- **Le jeton est un mot de passe** limité : il ne peut **qu'écrire** des mesures dans *ton*
  profil. Il n'ouvre aucune session, ne lit rien, et n'est accepté par aucune autre route.
- **Ne partage pas le Raccourci** (le lien de partage iCloud embarque le jeton). Pour aider
  quelqu'un, partage ce guide.
- **Téléphone perdu ou changé ?** Biscotos → Apple Santé → **Révoquer**. Effet immédiat.
- Uniquement en **HTTPS** : ton tunnel / reverse proxy doit terminer TLS (cf.
  `docs/SELF_HOSTING.md`). Le jeton n'est jamais mis dans l'URL (les URL finissent dans les logs).
- Limites : 60 requêtes/min par adresse, 30/min par jeton, 256 Kio et 500 mesures par requête.
  Derrière un tunnel (Cloudflare…), active `TRUST_PROXY=1` pour que la limite par adresse
  compte les vraies adresses et non celle du tunnel.
- Création et révocation des jetons sont tracées dans le journal d'audit (`data/audit.log`),
  sans le jeton.
- Les mesures sont stockées dans `data/health-<uid>.json` (0600) et supprimées avec le compte.

## 5. Et ensuite

Les mesures reçues sont visibles dans la feuille Apple Santé. Les prochaines étapes (hors de cette
phase) : proposer le poids reçu dans la courbe de poids (`state.bodyweight`, côté client, pour
garder une seule source de vérité), les afficher dans Stats, et les donner au coach IA sous forme
agrégée. Voir `docs/ARCHITECTURE.md`.
