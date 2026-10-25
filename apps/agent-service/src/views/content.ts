import { jsonByteLength, VIEW_DATA_MAX_BYTES, type ShowUiParams } from '@atd/agent-contracts';

/**
 * What `show_ui` refuses beyond its schema. The tool (tools.ts) and the document routes
 * (routes.ts) run the same check, so a call the tool rejected is never served. Pure: the kit's
 * block names come in. The view CSP the shell sets is what enforces "no network"; these checks
 * give the model an actionable error instead of a view that silently fails to load. The markup
 * rules are the same for the window's `html` and the `widget`; each problem names its field.
 */

/** Opening tags of a document wrapper: a view's markup is the content of its body only. */
const WRAPPER_TAGS: ReadonlySet<string> = new Set(['html', 'head', 'body']);

/** Elements that embed another document or a plugin. */
const EMBEDDING_TAGS: ReadonlySet<string> = new Set([
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
]);

/** Attributes whose URL an element loads by itself. */
const RESOURCE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'src',
  'srcset',
  'poster',
  'data',
  'background',
]);

/** A URL that loads from the network: http, https or scheme-relative. */
const REMOTE_URL = /^\s*(?:https?:|\/\/)/i;

const DOCTYPE = /<!doctype/i;

/**
 * The name of an opening tag, wherever it appears: markup a script writes from a string counts.
 * Its attributes follow (`TAG_ATTRIBUTES`).
 */
const TAG_NAME = /<([a-z][a-z0-9:-]*)/gi;

/**
 * A tag's attributes, read from the end of its name up to the next `<` or `>`, with quoted values
 * taken whole. Stopping at `<` keeps the scan linear and lets every tag start a scan of its own.
 */
const TAG_ATTRIBUTES = String.raw`(?:"[^"<>]*"|'[^'<>]*'|[^"'<>])*`;

/** One attribute of a tag: its name and its value, double-quoted, single-quoted or bare. */
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** A CSS `url()` (in a `<style>`, a `style` attribute or a script) that loads from the network. */
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:https?:|\/\/)/i;

/** A CSS `@import` of a stylesheet from the network, quoted or through `url()`. */
const REMOTE_CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?\s*(?:https?:|\/\/)/i;

const NO_NETWORK = 'a view loads nothing from the network';
const EMBED_INSTEAD = 'use a data: URL, inline SVG or CSS instead';

/**
 * Every problem of a `show_ui` call whose arguments passed the schema, as sentences the model can
 * act on; empty when the call may be shown. `blocks` is the kit's block set by name.
 */
export function viewProblems(params: ShowUiParams, blocks: ReadonlyMap<string, unknown>): string[] {
  const problems = new Set<string>();
  const data = viewDataProblem(params.data);
  if (data) problems.add(data);
  const unknown = [...new Set(params.blocks ?? [])].filter((name) => !blocks.has(name));
  if (unknown.length)
    problems.add(
      `blocks lists ${unknown.join(', ')}, which the kit does not have. Valid blocks: ${[...blocks.keys()].sort().join(', ')}.`,
    );
  for (const problem of markupProblems('html', params.html)) problems.add(problem);
  if (params.widget !== undefined)
    for (const problem of markupProblems('widget', params.widget)) problems.add(problem);
  return [...problems];
}

/** Why a view's `data` (of `show_ui` or `update_ui`) is refused; null when it fits. */
export function viewDataProblem(data: unknown): string | null {
  const bytes = jsonByteLength(data);
  return bytes > VIEW_DATA_MAX_BYTES
    ? `data is ${bytes} bytes of JSON, over the limit of ${VIEW_DATA_MAX_BYTES}: pass less data or summarize it.`
    : null;
}

/** The `show_ui` arguments that carry markup, as the problems name them. */
type MarkupField = 'html' | 'widget';

/** The problems of one field's markup, each once. */
function markupProblems(field: MarkupField, markup: string): string[] {
  const problems = new Set<string>();
  if (DOCTYPE.test(markup)) problems.add(wrapperProblem(field, '<!doctype>'));
  const rest = new RegExp(TAG_ATTRIBUTES, 'y');
  for (const match of markup.matchAll(TAG_NAME)) {
    const tag = (match[1] ?? '').toLowerCase();
    rest.lastIndex = match.index + match[0].length;
    const attributes = attributesOf(rest.exec(markup)?.[0] ?? '');
    const problem = tagProblem(field, tag, attributes);
    if (problem) problems.add(problem);
    for (const [name, value] of attributes)
      if (RESOURCE_ATTRIBUTES.has(name) && value !== null && loadsRemotely(name, value))
        problems.add(
          `${field} loads <${tag} ${name}> from the network, but ${NO_NETWORK}: ${EMBED_INSTEAD}.`,
        );
  }
  if (REMOTE_CSS_URL.test(markup))
    problems.add(
      `${field} uses a CSS url() from the network, but ${NO_NETWORK}: ${EMBED_INSTEAD}.`,
    );
  if (REMOTE_CSS_IMPORT.test(markup))
    problems.add(
      `${field} imports a stylesheet from the network, but ${NO_NETWORK}: put the styles in an inline <style> element.`,
    );
  return [...problems];
}

/** What is wrong with an element itself, whatever its URLs; null when nothing is. */
function tagProblem(
  field: MarkupField,
  tag: string,
  attributes: ReadonlyMap<string, string | null>,
): string | null {
  if (WRAPPER_TAGS.has(tag)) return wrapperProblem(field, `<${tag}>`);
  if (EMBEDDING_TAGS.has(tag))
    return `${field} contains <${tag}>, but a view cannot embed other documents or plugins.`;
  if (tag === 'base')
    return `${field} contains <base>, but a view cannot change how its URLs resolve.`;
  if (tag === 'link')
    return `${field} contains <link>, but ${NO_NETWORK}: put styles in an inline <style> element.`;
  if (tag === 'meta' && attributes.has('http-equiv'))
    return `${field} contains <meta http-equiv>, but a view cannot set document headers.`;
  if (tag === 'script' && attributes.has('src'))
    return `${field} contains <script src>, but ${NO_NETWORK}: write scripts inline in <script> elements.`;
  return null;
}

function wrapperProblem(field: MarkupField, found: string): string {
  return `${field} contains a document wrapper (${found}): pass only what goes inside <body>; the app builds the document around it.`;
}

/** A tag's attributes by lowercase name, the first of repeated names kept as HTML keeps it. */
function attributesOf(text: string): Map<string, string | null> {
  const attributes = new Map<string, string | null>();
  for (const [, name = '', double, single, bare] of text.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase();
    if (!attributes.has(key)) attributes.set(key, double ?? single ?? bare ?? null);
  }
  return attributes;
}

/** Whether an attribute value names a network URL; each `srcset` candidate is checked. */
function loadsRemotely(attribute: string, value: string): boolean {
  const urls = attribute === 'srcset' ? value.split(',') : [value];
  return urls.some((url) => REMOTE_URL.test(url));
}
