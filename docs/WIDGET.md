# Widget iPhone (Scriptable)

Une appli web ne peut pas faire de widget iOS : il faut une vraie appli native, donc un compte
développeur Apple payant. Contournement gratuit : **Scriptable**, une appli gratuite de l'App Store
qui exécute un petit script JavaScript et le dessine en widget. Biscotos génère ce script et fournit
la route qui lui donne les chiffres.

Il affiche, en petit, moyen, grand, ou sur l'écran verrouillé (cercle, rectangle, ligne) :

- le **rond des calories** du jour (mangé / objectif) ;
- le **rond des pas** (objectif de pas de « Corps et objectifs ») ;
- la **série** de semaines et les **séances de la semaine** ;
- en grand, les trois **macros** avec leur barre.

Les couleurs suivent l'accent choisi dans les réglages. Le rendu est un dessin : pas d'animation, et
iOS rafraîchit un widget toutes les 15 à 30 minutes environ, quand il le décide.

## Mise en place (une fois par personne)

1. Installer **Scriptable** depuis l'App Store.
2. Dans Biscotos : **Réglages → Corps et objectifs → Widget iPhone → Créer une clé de widget**, puis
   **Copier le script**. La clé est dans le script copié ; elle n'est plus affichée ensuite.
3. Dans Scriptable : **+**, coller, nommer le script « Biscotos ».
4. Écran d'accueil : appui long → **+** → **Scriptable** → ajouter le widget → toucher le widget →
   *Script* : « Biscotos ». Même chose sur l'écran verrouillé (iOS 16 ou plus) pour les formats
   cercle, rectangle et ligne.

Lancer le script dans Scriptable affiche un aperçu du widget moyen.

## Pour l'hébergeur

La route est `GET /api/hooks/widget`. Elle est sous `/api/hooks/`, comme le webhook Apple Santé :
**la règle Bypass de l'accès Cloudflare pour `/api/hooks/*` la couvre déjà**, rien d'autre à ouvrir.

**Vérifier que la règle Bypass est active** (sans clé, depuis n'importe où) :

```bash
curl -i https://ton-site/api/hooks/widget
```

- `401 {"error":"invalid widget key"}` : la route est joignable, c'est ce qu'on veut ;
- `302` vers `….cloudflareaccess.com/cdn-cgi/access/login/…` : la règle Bypass n'est **pas** effective
  sur ce chemin. Le widget et le Raccourci Apple Santé reçoivent alors la page de connexion au lieu
  de l'API. Vérifier dans Zero Trust → Access → Applications : une application « Self-hosted » sur le
  même domaine, chemin `api/hooks/*`, avec une politique d'action **Bypass** pour **Everyone**.

- Elle ne répond qu'à une **clé de widget** (`Authorization: Bearer bxh_…`). Pas de session, pas de
  clé Apple Santé : une clé d'un type est refusée par la route de l'autre, donc une clé de widget
  perdue ne permet de lire que ce résumé et n'écrit rien.
- La réponse ne contient que des **chiffres** de la personne : série, séances, calories et macros du
  jour contre l'objectif, pas contre l'objectif de pas. Aucun nom d'aliment, aucun nom, aucun
  identifiant. Détail dans `api/openapi.yaml`.
- Limites : 60 requêtes par minute par adresse, 30 par clé.
- Une clé se révoque depuis la même fenêtre (**Révoquer**) : à faire si le téléphone est perdu.
- L'objectif de calories du jour, quand il est *calculé* (Corps et objectifs), n'est connu du
  serveur que parce que l'appli le lui confie à chaque ouverture de l'écran Nutrition ou de
  l'accueil (`profile.goalToday`). Si l'appli n'a pas été ouverte aujourd'hui, le widget montre
  l'objectif saisi à la main, ou aucun objectif.

## Le script

Le script est `frontend/src/lib/widget-script.src.js`, un vrai fichier JavaScript. L'appli y met
l'adresse du serveur, la clé et la langue (français ou anglais) au moment de la copie
(`widget-script.js`). Les tests l'exécutent avec des doublures des objets de Scriptable : chaque
format, la langue, le mode hors ligne (il garde le dernier résumé dans le dossier de Scriptable,
sans la clé) et les réponses invalides.
