# Biscotos — boîte à idées

Tes amis proposent des améliorations depuis l'application (**Accueil → Idées**), voient celles des
autres et peuvent mettre un **+1**. L'administrateur marque une idée comme *faite* ou *refusée*.

## Vers GitHub (facultatif)

Avec `IDEAS_GITHUB_TOKEN` et `IDEAS_GITHUB_REPO` (Portainer ou `.env`), chaque nouvelle idée est
aussi ouverte comme **ticket GitHub anonyme** sur ce dépôt :

- aucun nom ni identifiant de profil, seulement le titre et les détails ;
- les `@` sont neutralisés (personne n'est notifié) et le texte est cité en bloc ;
- étiquette `idea` (si le jeton ne peut pas la créer, le ticket est ouvert sans) ;
- une idée que GitHub refuse reste dans l'application et est renvoyée toutes les 10 minutes
  (5 essais au plus) ; le jeton n'apparaît jamais dans les journaux.

**Le dépôt est public : l'idée l'est aussi.** L'application le rappelle sous le formulaire.

### Créer le jeton

GitHub → Settings → Developer settings → **Fine-grained tokens** → *Generate new token* :
- *Repository access* : **Only select repositories** → le dépôt Biscotos ;
- *Permissions* → *Repository permissions* → **Issues : Read and write** (rien d'autre) ;
- une date d'expiration (renouvelle-le ensuite).

Puis dans Portainer (variables de la stack) :

```env
IDEAS_GITHUB_TOKEN=github_pat_…
IDEAS_GITHUB_REPO=Hugo-Mllr/Biscotos
```

## Limites

5 idées par jour et par profil, 500 au total ; titre de 3 à 80 caractères, détails jusqu'à 1000.
Données : `data/ideas.json` (0600). Code : `api/ideas/index.js`, tests `api/test/ideas-routes.test.js`.
