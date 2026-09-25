/**
 * Names of the harness tools. They are not snapshot tools (`ServiceToolIdSchema`): every parent
 * run gets them beside its snapshot tools (the service run binding) and roles do not grant them.
 * Subagent children inherit the web tools and, when the run enables memory, memory search; the
 * others stay parent-only. Transcript rows key on these names.
 */

/** rpiv-todo's tool; its name is the key of its branch replay, so it never changes. */
export const TODO_TOOL = 'todo';
/** pi-web-access default tool names, kept so the package's replay and prompts stay valid. */
export const WEB_SEARCH_TOOL = 'web_search';
export const WEB_FETCH_TOOL = 'fetch_content';

/** pi-hermes-memory tools, registered only when the run snapshot enables memory. */
export const MEMORY_TOOLS: readonly string[] = [
  'memory_search',
  'memory_add',
  'memory_replace',
  'memory_remove',
];
