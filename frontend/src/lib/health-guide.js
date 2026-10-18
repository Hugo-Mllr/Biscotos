// Biscotos: the step-by-step guide to the Apple Health Shortcut, as the import sheet shows it
// (docs/APPLE_HEALTH.md § 3 is the long version). iOS names its actions in the phone's language,
// so the steps exist in French and English; every other language reads the English ones, with
// the action names a French or English iPhone shows.

/** The body the Shortcut posts: paste it into a Text action, then put the variables in place of the [names]. */
export const SHORTCUT_JSON = '{"samples":[' +
  '{"type":"weight","date":"[Jour]","value":"[Poids]","unit":"kg"},' +
  '{"type":"steps","date":"[Jour]","value":"[Pas]"},' +
  '{"type":"sleepMin","date":"[Jour]","value":"[Sommeil]","unit":"h"},' +
  '{"type":"restingHr","date":"[Jour]","value":"[FCRepos]"}]}'

// copy: 'json' | 'url' | 'auth' marks the step a copy button goes with.
const FR = [
  { title: 'Crée le Raccourci', text: 'App Raccourcis → + → nomme-le « Biscotos ».' },
  { title: 'La date du jour', text: 'Action « Date actuelle », puis « Formater la date » : format ISO 8601, sans l’heure. Renomme la sortie « Jour » (appui long → Renommer).' },
  { title: 'Les mesures', text: 'Une action « Rechercher des échantillons de santé » par mesure. Poids : plus récent d’abord, limite 1, puis « Obtenir les détails » → Valeur, renommée « Poids ». Pas : date de début aujourd’hui, puis « Calculer des statistiques » → Somme, renommée « Pas ». Sommeil : Analyse du sommeil, dernier jour, Endormi → Durée → Somme en heures, renommée « Sommeil ». FC au repos : plus récent, limite 1 → Valeur, renommée « FCRepos ». Garde seulement celles que tu veux.' },
  { title: 'Le texte à envoyer', text: 'Action « Texte » : colle le modèle ci-dessous, puis remplace chaque [Nom] par la variable du même nom (touche le mot, puis choisis la variable). Retire les lignes des mesures que tu n’envoies pas.', copy: 'json' },
  { title: 'L’envoi', text: 'Action « Obtenir le contenu de l’URL » : colle l’adresse, Méthode POST. En-têtes : « Authorization » = « Bearer » suivi d’un espace et de ton jeton, « Content-Type » = « application/json ». Corps : Fichier → la sortie de « Texte ».', copy: 'url' },
  { title: 'Tous les soirs', text: 'Onglet Automatisation → + → Heure de la journée, 21:00, Quotidien, Exécuter immédiatement → le Raccourci « Biscotos ». Autorise l’accès Santé aux seules mesures utilisées.' },
  { title: 'Vérifie', text: 'Lance le Raccourci une fois à la main : la valeur apparaît plus bas, dans « Reçu cette semaine ».' },
]
const EN = [
  { title: 'Create the Shortcut', text: 'Shortcuts app → + → name it “Biscotos”.' },
  { title: 'Today’s date', text: '“Current Date”, then “Format Date”: ISO 8601, time off. Rename the output “Jour” (long press → Rename).' },
  { title: 'The measurements', text: 'One “Find Health Samples” action per measurement. Weight: latest first, limit 1, then “Get Details” → Value, renamed “Poids”. Steps: start date is today, then “Calculate Statistics” → Sum, renamed “Pas”. Sleep: Sleep Analysis, last 1 day, Asleep → Duration → Sum in hours, renamed “Sommeil”. Resting heart rate: latest, limit 1 → Value, renamed “FCRepos”. Keep only the ones you want.' },
  { title: 'The text to send', text: '“Text” action: paste the template below, then replace each [Name] with the variable of the same name (tap the word, pick the variable). Remove the lines of measurements you don’t send.', copy: 'json' },
  { title: 'Sending it', text: '“Get Contents of URL”: paste the address, Method POST. Headers: “Authorization” = “Bearer”, a space and your token; “Content-Type” = “application/json”. Request body: File → the output of “Text”.', copy: 'url' },
  { title: 'Every evening', text: 'Automation tab → + → Time of Day, 21:00, Daily, Run Immediately → the “Biscotos” Shortcut. Allow Health access to the measurements you use only.' },
  { title: 'Check', text: 'Run the Shortcut once by hand: the value shows up below, under “Received this week”.' },
]

/** The steps for a language tag: French for fr-*, English otherwise. */
export const guideSteps = lang => (/^fr\b/i.test(String(lang || '')) ? FR : EN)
