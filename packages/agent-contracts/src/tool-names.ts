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

/** Adds or updates one MCP server in the user's catalog. Parent-only. */
export const CONFIGURE_MCP_TOOL = 'configure_mcp';
/** Lists the user's MCP servers as `configure_mcp` edits them. Parent-only. */
export const LIST_MCP_TOOL = 'list_mcp_servers';

/**
 * Loads one skill from the run's model-invocable catalog. Parent-only, and registered only when
 * that catalog is not empty.
 */
export const LOAD_SKILL_TOOL = 'load_skill';

/**
 * The memory engine's read tools (docs/plans/2026-10-04-skill-shaped-memory.md): child runs get
 * these and nothing else, and learning pause never blocks them.
 */
export const MEMORY_READ_TOOLS: readonly string[] = ['memory_search', 'memory_read'];

/** The memory engine's write tools: root runs only, each call gated by the learning policy. */
export const MEMORY_WRITE_TOOLS: readonly string[] = [
  'memory_add',
  'memory_replace',
  'memory_remove',
];
