import { EXTENSION_TO_FILE_FORMAT, getFiletypeFromFileName } from '@pierre/diffs';
import { bundledLanguages, bundledLanguagesInfo } from 'shiki';

/**
 * Every language and alias (`shell`, `docker`, `c++`…) of the Shiki bundle `@pierre/diffs`
 * highlights with — the same single `shiki` this app depends on, so a name listed here loads. Both
 * code renderers (the settled `CodeBlock` and the streaming one) are `@pierre/diffs`.
 */
const LANGUAGES: ReadonlySet<string> = new Set(Object.keys(bundledLanguages));

/**
 * A fence label or file extension as a language the highlighter loads: a language name as is,
 * else the language its extension maps to, else plain text. An unknown name would fail to load
 * instead of falling back.
 */
export function codeLanguage(label: string): string {
  const name = label.trim().toLowerCase();
  if (!name) return 'text';
  return LANGUAGES.has(name) ? name : getFiletypeFromFileName(`file.${name}`);
}

/** A plain file extension, not a compound key (`component.ts`) or a file name (`Dockerfile`). */
const PLAIN_EXTENSION = /^[a-z0-9]+$/;

/**
 * The extension a code block saves under, for a language from `codeLanguage`: the first extension
 * `@pierre/diffs` maps to the language, else the shortest of its names that is itself an extension
 * (`shellscript` → `sh`), else `txt`.
 */
export function codeFileExtension(language: string): string {
  const name = language.trim().toLowerCase();
  const info = bundledLanguagesInfo.find(
    (entry) => entry.id === name || entry.aliases?.includes(name),
  );
  const id = info?.id ?? name;
  const extensions = Object.entries(EXTENSION_TO_FILE_FORMAT);
  const mapped = extensions.find(([key, format]) => format === id && PLAIN_EXTENSION.test(key));
  if (mapped) return mapped[0];
  const named = [name, id, ...(info?.aliases ?? [])]
    .filter((candidate) => PLAIN_EXTENSION.test(candidate) && candidate in EXTENSION_TO_FILE_FORMAT)
    .sort((a, b) => a.length - b.length);
  return named[0] ?? 'txt';
}
