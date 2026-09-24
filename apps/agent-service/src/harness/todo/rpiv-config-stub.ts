/**
 * Stand-in for `@juicesharp/rpiv-config`, aliased in place of the real package when rpiv-todo is
 * loaded (harness/todo/loader.ts). rpiv-todo's `config.ts` reads `~/.config/rpiv-todo/config.json`
 * (or `$XDG_CONFIG_HOME/rpiv-todo`) through `loadJsonConfigWithLegacyFallback` at factory time and on
 * every tool registration; the service must not pick up a user's personal rpiv configuration, so
 * this module answers with fixed defaults and never touches the filesystem.
 *
 * Only the two runtime exports rpiv-todo 2.11.0 imports are provided.
 */

/** rpiv-todo's `TodoConfig`, fixed: no guidance override and no overlay collapse shortcut. */
interface ServiceTodoConfig {
  collapseKey: 'off';
}

/** Upstream's `GuidanceFields`: prompt copy overrides for the tool registration. */
interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
  description?: string;
}

const RPIV_TODO_CONFIG = 'rpiv-todo';

/**
 * Upstream reads `<config dir>/<name>/<file>` and returns `{}` when it is missing. Here the only
 * caller is rpiv-todo, which gets its defaults plus `collapseKey: 'off'` so it registers no
 * keyboard shortcut in a headless service. Any other caller means the aliased dependency graph
 * changed and must be reviewed, so it fails loudly instead of silently returning defaults.
 */
export function loadJsonConfigWithLegacyFallback(name: string): ServiceTodoConfig {
  if (name !== RPIV_TODO_CONFIG) {
    throw new Error(`Unexpected rpiv config request for "${name}"; only rpiv-todo is stubbed.`);
  }
  return { collapseKey: 'off' };
}

/**
 * Same contract as upstream `validateGuidanceFields` (rpiv-config 2.11.0): keeps only non-empty
 * string fields and a non-empty all-string `promptGuidelines`, and returns `{}` for anything that
 * is not an object. With the fixed config above it always receives `undefined`, so rpiv-todo
 * keeps its default prompt snippet and guidelines.
 */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
  if (!fields || typeof fields !== 'object') return {};
  const { promptSnippet, promptGuidelines, description } = fields as Record<string, unknown>;
  const result: GuidanceFields = {};
  if (typeof promptSnippet === 'string' && promptSnippet.length > 0) {
    result.promptSnippet = promptSnippet;
  }
  if (
    Array.isArray(promptGuidelines) &&
    promptGuidelines.length > 0 &&
    promptGuidelines.every((line) => typeof line === 'string' && line.length > 0)
  ) {
    result.promptGuidelines = promptGuidelines;
  }
  if (typeof description === 'string' && description.length > 0) result.description = description;
  return result;
}
