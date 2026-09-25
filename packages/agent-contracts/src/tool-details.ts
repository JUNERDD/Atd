import { Type, type Static } from 'typebox';

/**
 * Structured, renderable facts of one tool result (`ServiceBlock` tool `details`). The service
 * transcript projection builds them from Pi's `ToolResultMessage.details` by whitelisting fields
 * and clamping every string and list to the bounds below; raw tool details never cross the
 * service boundary. A block has no `details` when its tool has no variant here, while it runs,
 * or when its result is an error; `subagent` is the one exception and also carries details while
 * running and on failure (see `SubagentDetailsSchema`). `truncated` reports that the projection
 * dropped items or characters.
 */

export const TODO_DETAILS_MAX_ITEMS = 100;
export const TODO_SUBJECT_MAX_LENGTH = 500;
export const TODO_ACTIVE_FORM_MAX_LENGTH = 200;
export const TODO_BLOCKED_BY_MAX_ITEMS = 50;
export const EDIT_DIFF_MAX_LENGTH = 200000;
export const WEB_SEARCH_MAX_QUERIES = 8;
export const WEB_SEARCH_MAX_RESULTS = 20;
export const WEB_FETCH_MAX_PAGES = 10;
export const WEB_EXCERPT_MAX_LENGTH = 2000;
export const WEB_SNIPPET_MAX_LENGTH = 1000;
export const WEB_TITLE_MAX_LENGTH = 300;
export const WEB_URL_MAX_LENGTH = 2048;
export const SUBAGENT_DETAILS_MAX_CHILDREN = 32;
export const SUBAGENT_TASK_MAX_LENGTH = 500;
export const SUBAGENT_OUTPUT_MAX_LENGTH = 8000;
export const SUBAGENT_ERROR_MAX_LENGTH = 2000;

/** rpiv-todo task status; `deleted` is a tombstone the UI hides. */
export const TodoStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('deleted'),
]);
export type TodoStatus = Static<typeof TodoStatusSchema>;

export const TodoItemSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 0 }),
    subject: Type.String({ maxLength: TODO_SUBJECT_MAX_LENGTH }),
    status: TodoStatusSchema,
    /** Present-continuous label shown while `in_progress`. */
    activeForm: Type.Optional(Type.String({ maxLength: TODO_ACTIVE_FORM_MAX_LENGTH })),
    blockedBy: Type.Array(Type.Integer({ minimum: 0 }), { maxItems: TODO_BLOCKED_BY_MAX_ITEMS }),
  },
  { additionalProperties: false },
);
export type TodoItem = Static<typeof TodoItemSchema>;

/**
 * The whole todo list after a successful `todo` call (rpiv-todo `TaskDetails.tasks`), in id
 * order. The latest todo block of the branch is the current list. Over the item cap, deleted
 * items are dropped first, then the highest ids.
 */
export const TodoDetailsSchema = Type.Object(
  {
    type: Type.Literal('todo'),
    tasks: Type.Array(TodoItemSchema, { maxItems: TODO_DETAILS_MAX_ITEMS }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TodoDetails = Static<typeof TodoDetailsSchema>;

/** Pi's edit diff (`EditToolDetails.diff`), clamped to the desktop diff bound. */
export const EditDiffDetailsSchema = Type.Object(
  {
    type: Type.Literal('diff'),
    diff: Type.String({ maxLength: EDIT_DIFF_MAX_LENGTH }),
    firstChangedLine: Type.Optional(Type.Integer({ minimum: 1 })),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type EditDiffDetails = Static<typeof EditDiffDetailsSchema>;

export const WebSearchResultSchema = Type.Object(
  {
    title: Type.String({ maxLength: WEB_TITLE_MAX_LENGTH }),
    url: Type.String({ maxLength: WEB_URL_MAX_LENGTH }),
    snippet: Type.String({ maxLength: WEB_SNIPPET_MAX_LENGTH }),
  },
  { additionalProperties: false },
);
export type WebSearchResult = Static<typeof WebSearchResultSchema>;

/** Results of one `web_search` call across its queries; `provider` is the provider id used. */
export const WebSearchDetailsSchema = Type.Object(
  {
    type: Type.Literal('webSearch'),
    queries: Type.Array(Type.String({ maxLength: 500 }), { maxItems: WEB_SEARCH_MAX_QUERIES }),
    provider: Type.String({ maxLength: 64 }),
    results: Type.Array(WebSearchResultSchema, { maxItems: WEB_SEARCH_MAX_RESULTS }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type WebSearchDetails = Static<typeof WebSearchDetailsSchema>;

/** One fetched URL: an excerpt of the extracted text plus its full length in characters. */
export const WebFetchPageSchema = Type.Object(
  {
    url: Type.String({ maxLength: WEB_URL_MAX_LENGTH }),
    title: Type.String({ maxLength: WEB_TITLE_MAX_LENGTH }),
    excerpt: Type.String({ maxLength: WEB_EXCERPT_MAX_LENGTH }),
    length: Type.Integer({ minimum: 0 }),
    /** Why this URL could not be fetched; the other pages of the call may still succeed. */
    error: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);
export type WebFetchPage = Static<typeof WebFetchPageSchema>;

export const WebFetchDetailsSchema = Type.Object(
  {
    type: Type.Literal('webFetch'),
    pages: Type.Array(WebFetchPageSchema, { maxItems: WEB_FETCH_MAX_PAGES }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type WebFetchDetails = Static<typeof WebFetchDetailsSchema>;

export const SubagentChildStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('interrupted'),
]);
export type SubagentChildStatus = Static<typeof SubagentChildStatusSchema>;

/**
 * One child the parent `subagent` call launched. Identity comes from the parent session's
 * `app-child` entry (subagents.ts); status, usage and output enrich it from pi-subagents' result
 * rows matched by `sessionFile`, so a row without a match shows only identity and `running`.
 */
export const SubagentChildSummarySchema = Type.Object(
  {
    /** `<toolCallId>:<seq>`: the child transcript key (`subagentChildKey`). */
    key: Type.String({ maxLength: 512 }),
    seq: Type.Integer({ minimum: 0 }),
    /** `child:<parentRunId>:<n>`; confirms raised by this child carry it. */
    executionId: Type.String({ maxLength: 256 }),
    agent: Type.String({ maxLength: 128 }),
    /** The delegated task from the call args, clamped; pi-subagents redacts its own copy. */
    task: Type.String({ maxLength: SUBAGENT_TASK_MAX_LENGTH }),
    status: SubagentChildStatusSchema,
    model: Type.Optional(Type.String({ maxLength: 256 })),
    /** Tool the child is running now; only while `running`. */
    currentTool: Type.Optional(Type.String({ maxLength: 128 })),
    toolCount: Type.Integer({ minimum: 0 }),
    turnCount: Type.Optional(Type.Integer({ minimum: 0 })),
    durationMs: Type.Integer({ minimum: 0 }),
    inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Final answer preview; empty until the child ends. */
    finalOutput: Type.String({ maxLength: SUBAGENT_OUTPUT_MAX_LENGTH }),
    error: Type.String({ maxLength: SUBAGENT_ERROR_MAX_LENGTH }),
  },
  { additionalProperties: false },
);
export type SubagentChildSummary = Static<typeof SubagentChildSummarySchema>;

/** Children of one launching `subagent` call in launch (`seq`) order. */
export const SubagentDetailsSchema = Type.Object(
  {
    type: Type.Literal('subagent'),
    children: Type.Array(SubagentChildSummarySchema, { maxItems: SUBAGENT_DETAILS_MAX_CHILDREN }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SubagentDetails = Static<typeof SubagentDetailsSchema>;

export const ToolBlockDetailsSchema = Type.Union([
  TodoDetailsSchema,
  EditDiffDetailsSchema,
  WebSearchDetailsSchema,
  WebFetchDetailsSchema,
  SubagentDetailsSchema,
]);
export type ToolBlockDetails = Static<typeof ToolBlockDetailsSchema>;
