# Biscotos — direction design

> **Mise à jour du 15 octobre — couleurs choisies par chacun.** Le Volt fixe a laissé la place à
> la couleur d'accent de l'app (Réglages → Apparence, **violet par défaut**) : `--bx-volt` vaut
> `var(--acc)`, et les fonds Biscotos reprennent ceux de l'app (`--bg`, `--surface`…). Le
> **fond teinté** (`lib/tint.js`, activé par défaut) mélange 3 à 12 % de l'accent dans chaque
> fond, en sombre comme en clair, texte toujours ≥ 7:1 (`tint.test.js`). Sur PC (≥ 1000 px) :
> barre latérale et pages sur deux colonnes. Le tableau ci-dessous décrit la version d'origine.

## Direction : « Nocturne de stade »

Un stade la nuit, projecteurs éteints sauf le tableau d'affichage. Fond d'encre (pas du noir
pur), surfaces graphite, et **un seul accent électrique — le Volt** (`#d4ff3a`) — réservé à ce
qui compte : le score du jour, l'action principale, la progression. Un second signal chaud,
**Braise** (`#ff6b2c`), n'apparaît que pour les records, les séries et les dépassements.

- **Les chiffres sont les héros.** Grands numéraux condensés, interlettrage serré, chiffres
  tabulaires : kcal du jour, charge, 1RM se lisent de loin, téléphone posé sur un banc.
- **Typographie massive, texte calme.** Titres en capitales condensées, petites étiquettes en
  capitales espacées (`.bx-kicker`, `.bx-label`), corps de texte sobre en poids 400–600.
- **Pas de décor.** Aucun dégradé décoratif, aucune ombre portée en sombre (la profondeur vient
  d'un filet clair en haut des cartes). La couleur est une information, jamais un ornement.
- **Une couleur par macro, partout.** Protéines cyan, glucides ambre, lipides rose, kcal Volt :
  anneau, barre, puce et graphe parlent la même langue.
- **Mobile-first, en salle.** Cibles ≥ 44 px, boutons principaux 48 px pleine largeur, contrastes
  AA minimum, lisible en plein soleil (mode clair « papier chaud »).

### Pourquoi pas un look « template IA »

On évite les signatures habituelles : violet→bleu en dégradé, glassmorphism, coins arrondis
partout identiques, emoji en guise d'icônes, ombres douces sur fond blanc. À la place : contraste
fort, un accent unique et assumé, typographie condensée de tableau de score, grille de 4 px stricte.

## Fichiers

| Fichier | Rôle |
|---|---|
| `frontend/src/styles/biscotos.css` | Tokens `--bx-*`, thèmes sombre/clair, keyframes, primitives `.bx-*` |
| `frontend/src/lib/motion.js` (+ test) | Durées, courbes, `prefersReducedMotion()`, `tween`, `bezier`, `ringOffset` |
| `frontend/src/components/bx/index.jsx` (+ test) | `CountUp` / `useCountUp`, `Ring`, `Bar`, `Sheet` |

**Cohabitation avec openGym.** La couche Biscotos ne modifie aucun écran existant : tous les
tokens sont préfixés `--bx-`, toutes les règles sont sous `.bx`. Un écran adopte la direction avec
`className="bx"`. Le thème suit le réglage existant (`data-theme="dark|light"` sur `<html>`,
sombre par défaut). La refonte des écrans hérités viendra dans une phase dédiée.

## Tokens

### Couleurs

| Token | Sombre (défaut) | Clair | Usage |
|---|---|---|---|
| `--bx-bg` | `#0a0b0d` | `#f4f3ee` | fond de page |
| `--bx-surface` / `-2` / `-3` | `#14161a` / `#1d2026` / `#282c34` | `#fff` / `#ecebe5` / `#e0dfd8` | cartes / champs / pistes |
| `--bx-ink` / `-2` / `-3` | `#f4f5f1` à 100 / 64 / 38 % | `#0a0b0d` à 100 / 62 / 40 % | texte principal / secondaire / tertiaire |
| `--bx-volt` | `#d4ff3a` | idem (remplissage) | accent, CTA (fond Volt + encre) |
| `--bx-kcal` | = Volt | `#4d6600` | traits et graphes kcal (contraste ≥ 3:1 en clair) |
| `--bx-volt-text` | `#d4ff3a` | `#4d6600` | texte/traits Volt (6,9:1 sur papier) |
| `--bx-volt-ink` | `#0a0b0d` | idem | texte sur fond Volt (15,9:1) |
| `--bx-ember` | `#ff6b2c` | `#e5541b` | PR, streak, dépassement |
| `--bx-protein` / `-carbs` / `-fat` | `#5ac8fa` / `#ffc94a` / `#ff7ab6` | `#0a84c6` / `#c98a00` / `#d6337f` | macros |

### Typographie

Piles système uniquement (`--bx-font-ui`, `--bx-font-display` avec `font-stretch: condensed`) :
**aucune police chargée depuis un CDN** — pas de fuite vers un tiers, fonctionne hors ligne,
compatible avec une future CSP stricte. Échelle : 12 / 14 / 16 / 20 / 28 / 40 / 64 px
(`--bx-fs-xs` … `--bx-fs-score`).

### Espacements, rayons, ombres

- Grille de 4 px : `--bx-s1` (4) … `--bx-s7` (48).
- Rayons : 8 (`sm`), 14 (défaut), 20 (`lg`, cartes et feuilles), pilule.
- Élévation : `--bx-shadow-1/2` = filet clair intérieur + ombre courte ; `--bx-glow` = focus Volt.

## Animation

Système centralisé : **les durées et courbes existent une seule fois** en CSS (`--bx-dur-*`,
`--bx-ease-*`) et en JS (`lib/motion.js`), et un test vérifie qu'elles sont identiques.

| Token | Valeur | Usage |
|---|---|---|
| `instant` | 90 ms | retour de pression |
| `fast` | 160 ms | survol, focus, apparition de fond de feuille |
| `base` | 240 ms | cartes et lignes qui montent, feuille qui s'ouvre |
| `slow` | 420 ms | transition de page, pop de validation, PR |
| `draw` | 900 ms | compteurs qui défilent, anneaux et barres qui se dessinent |

| Courbe | Valeur | Usage |
|---|---|---|
| `out` | `cubic-bezier(.2,.8,.2,1)` | tout ce qui entre ou se pose (défaut) |
| `in-out` | `cubic-bezier(.65,0,.35,1)` | déplacement d'un point à un autre |
| `spring` | `cubic-bezier(.3,1.5,.5,1)` | **célébration uniquement** : série validée, PR |

### Règles

1. **Utile ou rien.** On anime pour expliquer (d'où vient l'élément, ce qui a changé, qu'une
   action a réussi), jamais pour décorer. Priorités : transitions de page (`bx-page-in`),
   compteurs (`CountUp`), graphes qui se dessinent (`Ring`, `Bar`), validation de série
   (`.bx-pop`, `.bx-flash`), PR (`.bx-pr`), micro-interactions (`.bx-tap`).
2. **Courts.** Rien au-delà de 420 ms sauf le dessin des données (900 ms), qui n'empêche jamais
   d'interagir.
3. **`transform` et `opacity` seulement** pour les animations récurrentes (pas de layout).
4. **`prefers-reduced-motion` est respecté partout** : en CSS, toutes les durées tombent à 1 ms
   et les animations `.bx` se limitent à une itération ; en JS, `duration()` renvoie 0 et
   `CountUp` / `Ring` / `Bar` affichent directement l'état final (testé).
5. **Le ressort est rare.** `spring` est réservé aux moments de réussite pour qu'ils restent
   remarquables.
6. **Échelonnement léger** : listes avec `.bx-stagger` et `--i` (40 ms par élément, max ~8).

## Accessibilité

- Contrastes : texte principal ≥ 12:1, secondaire ≥ 4,5:1 sur les deux thèmes ; Volt jamais
  utilisé comme couleur de texte sur fond clair (on passe par `--bx-volt-text`).
- Anneaux et barres ont `role="img"` / `role="progressbar"` + `aria-label` ; `CountUp` expose la
  valeur finale à l'`aria-label`, pas les valeurs intermédiaires.
- Focus visible : halo Volt (`--bx-glow`, ou anneau sur les champs).
- La couleur n'est jamais le seul signal : un dépassement d'objectif change aussi le texte
  (« +120 kcal »).
