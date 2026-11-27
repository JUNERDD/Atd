/**
 * What the options page shows that is its own: shortcuts drawn as keys, and an allowed origin as
 * the person reads it. The connection rules are every page's (`pages/link.ts`).
 */

/** The modifier symbols Chrome writes ahead of the key on a Mac, in the order macOS uses. */
const MAC_MODIFIERS: ReadonlySet<string> = new Set(['⌃', '⌥', '⇧', '⌘']);

/**
 * A shortcut as Chrome shows it, split into the keys to draw as keycaps: `⇧⌘K` on a Mac (each
 * leading modifier symbol, then the key), `Ctrl+Shift+K` elsewhere. The last part is always the
 * key, even when it is itself a modifier symbol or a `+`.
 */
export function shortcutKeys(shortcut: string): string[] {
  const chars = Array.from(shortcut);
  let modifiers = 0;
  while (modifiers < chars.length - 1 && MAC_MODIFIERS.has(chars[modifiers] ?? '')) modifiers++;
  if (modifiers > 0) return [...chars.slice(0, modifiers), chars.slice(modifiers).join('')];
  return shortcut.split(/\+(?!$)/);
}

/** An allowed origin as the person reads it: its host (and port), or the origin as sent. */
export function hostOf(origin: string): string {
  return URL.canParse(origin) ? new URL(origin).host : origin;
}
