// Biscotos: the Scriptable script of the iPhone widget (widget-script.src.js, a real script that is
// also run by the tests with stand-ins for Scriptable's objects), with this profile's address and
// widget key put in. The key is a secret: the script is copied to the phone's clipboard and never
// stored or logged here.
import source from './widget-script.src.js?raw'

/** The script text for `base` (the server's address, no trailing slash), `key` and a language. */
export function widgetScript({ base, key, lang }) {
  return source
    .replace('"__BASE__"', JSON.stringify(String(base).replace(/\/+$/, '')))
    .replace('"__KEY__"', JSON.stringify(String(key)))
    .replace('"__LANG__"', JSON.stringify(String(lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'))
}
