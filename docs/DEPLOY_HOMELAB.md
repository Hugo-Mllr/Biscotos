# Mettre Biscotos en ligne : homelab + Cloudflare Tunnel

Le but : Biscotos tourne dans Docker sur ton homelab, tes amis l'ouvrent en HTTPS sur ton
domaine, et **aucun port n'est ouvert** sur ta box. C'est Cloudflare Tunnel qui fait le lien.

> Tout ce qui suit utilise `biscotos.example.com` comme exemple. Ton vrai domaine, le jeton du
> tunnel et les adresses de ton réseau vont **uniquement** dans `.env` et `.env.tunnel`, qui
> sont ignorés par git. Ne les écris jamais dans un fichier versionné (le dépôt est public).

## 0. Ce qu'il te faut

- Docker et Docker Compose sur le homelab (`docker compose version`).
- Un domaine géré par Cloudflare (offre gratuite) et un compte Cloudflare Zero Trust (gratuit).
- Le dépôt cloné sur le homelab : `git clone https://github.com/Hugo-Mllr/Biscotos.git`.

## 1. Créer le tunnel (tableau de bord Cloudflare)

1. **Zero Trust → Networks → Tunnels → Create a tunnel** → type **Cloudflared**, nom « biscotos ».
2. À l'étape d'installation, choisis **Docker** et copie seulement le **jeton** (la longue
   chaîne après `--token`). Ne lance pas leur commande : le conteneur est déjà prévu ici.
3. **Public Hostname** : sous-domaine `biscotos`, domaine `example.com`,
   service **HTTP** → URL **`web:80`** (le nom du conteneur web dans compose, pas une IP).

## 2. Configurer Biscotos

```bash
cd Biscotos
cp .env.example .env
```

Dans `.env`, change ces lignes (le reste peut rester tel quel) :

```env
RP_ID=biscotos.example.com
ORIGIN=https://biscotos.example.com
RP_NAME=Biscotos
DEFAULT_LANG=fr
FIRST_USER_ADMIN=1
TZ=Europe/Paris
```

Puis crée `.env.tunnel` avec une seule ligne, le jeton copié à l'étape 1 :

```env
TUNNEL_TOKEN=colle-ici-le-jeton
```

```bash
chmod 600 .env .env.tunnel     # lisibles par toi seul
```

- `RP_ID` et `ORIGIN` = **exactement** l'adresse que tes amis taperont. Les passkeys y sont liées :
  changer de domaine plus tard oblige tout le monde à recréer la sienne.
- Tes passkeys de test `localhost` ne marcheront pas sur le domaine : tu recrées ton profil en ligne.

## 3. Lancer

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml logs -f cloudflared   # « Registered tunnel connection »
```

Le premier build prend quelques minutes. Ensuite ouvre `https://biscotos.example.com`.

Avec le fichier `docker-compose.tunnel.yml` :
- le port web n'écoute que sur `127.0.0.1` (le homelab lui-même), plus sur tout ton réseau ;
- l'adresse réelle des visiteurs arrive par l'en-tête Cloudflare (journal d'activité, limites
  anti-bruteforce et anti-spam du webhook).

## 4. Ton profil d'abord, puis tes amis

1. **Crée ton profil en premier**, avant de partager l'adresse : avec `FIRST_USER_ADMIN=1`, le
   premier profil devient administrateur (Réglages → Tableau d’administration).
2. Ferme l'inscription libre. Dans `.env` :
   ```env
   INVITE_ONLY=1
   ALLOW_GUEST=0
   ```
   puis `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d`.
3. Dans le tableau d’administration, **génère un code d'invitation** par ami et envoie-le-lui
   avec l'adresse.

### Sur iPhone (tes amis)

Safari → l'adresse → « Créer un nouveau profil » → code d'invitation → « Créer une passkey »
(Face ID). Puis **Partager → Sur l'écran d'accueil** : Biscotos s'ouvre alors comme une app,
en plein écran, avec sa propre icône. Apple Santé : `docs/APPLE_HEALTH.md`.

## 5. Mettre à jour

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Les données (`./data`) ne bougent pas.

## 6. Sauvegarder

Tout est dans `./data` : profils, passkeys, séances, nutrition, mesures Apple Santé, secret de
session. Une copie régulière suffit :

```bash
tar czf biscotos-$(date +%F).tar.gz data/
```

Garde ces archives hors du dépôt (ce sont des données personnelles de tes amis) et, idéalement,
sur un autre disque. Restauration : arrêter les conteneurs, décompresser à la place de `data/`,
relancer.

## 7. En cas de souci

| Symptôme | Cause probable |
|---|---|
| « La passkey a échoué » à l'inscription | `RP_ID` / `ORIGIN` ne correspondent pas exactement à l'adresse (https, pas de `/` final, pas de `www.`) |
| Page Cloudflare « Bad gateway » (502) | le service du tunnel ne pointe pas sur `web:80`, ou le conteneur web n'est pas démarré (`docker compose ps`) |
| La recherche d'aliments dit « injoignable » | le homelab n'atteint pas Open Food Facts ; `docker compose logs api` montre `[food] Open Food Facts … failed: …` (la cause, jamais ce qui a été cherché) |
| Tout le monde est bloqué « trop de tentatives » | il manque l'en-tête de l'adresse réelle : lance bien avec `-f docker-compose.tunnel.yml` |

Guide complet en anglais (options avancées, Kubernetes, autres reverse proxies) :
`docs/SELF_HOSTING.md`.
