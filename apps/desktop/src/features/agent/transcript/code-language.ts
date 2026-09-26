import { getFiletypeFromFileName } from '@pierre/diffs';
import { code } from '@streamdown/code';

/** Language names and aliases the highlighter bundles, widened to plain strings for lookup. */
const BUNDLED: ReadonlySet<string> = new Set<string>(code.getSupportedLanguages());

/**
 * A fence label or file extension as a language the highlighter bundles: a Shiki language name
 * or alias as is, else the language its extension maps to, else plain text. An unknown name
 * would fail to load instead of falling back.
 */
export function codeLanguage(label: string): string {
  const name = label.trim().toLowerCase();
  if (!name) return 'text';
  return BUNDLED.has(name) ? name : getFiletypeFromFileName(`file.${name}`);
}
