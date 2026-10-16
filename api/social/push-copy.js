/* Biscotos social notifications, in the languages the friends are likely to use; anything else
 * falls back to English. Names are profile names (chosen by their owners); no number but points
 * and counts ever goes into a notification. */
const COPY = {
  en: {
    reacted: (who, e, title) => `${who} reacted ${e} to ${title ? `your workout “${title}”` : 'your workout'}`,
    records: (who, n) => (n === 1 ? `🏆 ${who} just set a personal record` : `🏆 ${who} just set ${n} personal records`),
    recapTitle: name => `🏆 ${name}: the week is over`,
    shame: names => `0 points: ${names}`,
    nobody: 'Nobody scored this week. New week, new chances!',
    pts: 'pts',
  },
  fr: {
    reacted: (who, e, title) => `${who} a réagi ${e} à ${title ? `ta séance « ${title} »` : 'ta séance'}`,
    records: (who, n) => (n === 1 ? `🏆 ${who} vient de battre un record perso` : `🏆 ${who} vient de battre ${n} records perso`),
    recapTitle: name => `🏆 ${name} : la semaine est finie`,
    shame: names => `0 point : ${names}`,
    nobody: 'Personne n’a marqué cette semaine. Nouvelle semaine, nouvelle chance !',
    pts: 'pts',
  },
  de: {
    reacted: (who, e, title) => `${who} hat mit ${e} auf ${title ? `dein Training „${title}“` : 'dein Training'} reagiert`,
    records: (who, n) => (n === 1 ? `🏆 ${who} hat gerade einen Rekord aufgestellt` : `🏆 ${who} hat gerade ${n} Rekorde aufgestellt`),
    recapTitle: name => `🏆 ${name}: Die Woche ist vorbei`,
    shame: names => `0 Punkte: ${names}`,
    nobody: 'Diese Woche hat niemand gepunktet. Neue Woche, neue Chance!',
    pts: 'Pkt.',
  },
  es: {
    reacted: (who, e, title) => `${who} reaccionó ${e} a ${title ? `tu entreno «${title}»` : 'tu entreno'}`,
    records: (who, n) => (n === 1 ? `🏆 ${who} acaba de batir un récord personal` : `🏆 ${who} acaba de batir ${n} récords personales`),
    recapTitle: name => `🏆 ${name}: la semana ha terminado`,
    shame: names => `0 puntos: ${names}`,
    nobody: 'Nadie puntuó esta semana. ¡Nueva semana, nueva oportunidad!',
    pts: 'pts',
  },
  it: {
    reacted: (who, e, title) => `${who} ha reagito ${e} al ${title ? `tuo allenamento «${title}»` : 'tuo allenamento'}`,
    records: (who, n) => (n === 1 ? `🏆 ${who} ha appena fatto un record personale` : `🏆 ${who} ha appena fatto ${n} record personali`),
    recapTitle: name => `🏆 ${name}: la settimana è finita`,
    shame: names => `0 punti: ${names}`,
    nobody: 'Nessuno ha segnato punti questa settimana. Nuova settimana, nuova occasione!',
    pts: 'pt',
  },
  pt: {
    reacted: (who, e, title) => `${who} reagiu ${e} ao ${title ? `teu treino «${title}»` : 'teu treino'}`,
    records: (who, n) => (n === 1 ? `🏆 ${who} acabou de bater um recorde pessoal` : `🏆 ${who} acabou de bater ${n} recordes pessoais`),
    recapTitle: name => `🏆 ${name}: a semana terminou`,
    shame: names => `0 pontos: ${names}`,
    nobody: 'Ninguém pontuou esta semana. Nova semana, nova oportunidade!',
    pts: 'pts',
  },
};
COPY['pt-BR'] = { ...COPY.pt, reacted: (who, e, title) => `${who} reagiu ${e} ao ${title ? `seu treino “${title}”` : 'seu treino'}` };
COPY['de-CH'] = COPY.de;

export const copyFor = lang => COPY[lang] || COPY[String(lang || '').slice(0, 2)] || COPY.en;

export function reactionPush(lang, who, emoji, title) {
  return { title: 'Biscotos', body: copyFor(lang).reacted(who, emoji, title), tag: 'social-reaction', url: './league' };
}

export function recordsPush(lang, who, n) {
  return { title: 'Biscotos', body: copyFor(lang).records(who, n), tag: 'social-record', url: './league' };
}

/** rows: the last week's board, ranked; shame: whether to name those on 0. */
export function recapPush(lang, circleName, rows, shame) {
  const c = copyFor(lang);
  const scored = rows.filter(r => r.points > 0).slice(0, 3);
  const zero = rows.filter(r => r.points === 0).map(r => r.name);
  const podium = scored.map(r => `${r.rank}. ${r.name} ${r.points} ${c.pts}`).join(' · ');
  const body = [podium || c.nobody, shame && zero.length && scored.length ? c.shame(zero.join(', ')) : null].filter(Boolean).join('\n');
  return { title: c.recapTitle(circleName), body, tag: 'social-recap', url: './league' };
}
