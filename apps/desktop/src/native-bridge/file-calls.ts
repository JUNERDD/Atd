/**
 * The native bridge's file calls (`NativeFileCalls`, part of `NativeCalls` in `calls.ts`): open
 * panels for attachments and folders, the save panel, and artifact downloads, with the file and
 * folder records and import failures they and the drop events (`contract.ts`) carry. Loaded by the
 * export script with Node's type stripping, so it imports nothing but TypeBox and its sibling
 * contract files (by their `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type, type Static, type TSchema } from 'typebox';
import { Empty, MAX_NATIVE_TEXT_LENGTH, Text } from './primitives.ts';

const IdentifierPattern = '^[a-zA-Z0-9_-]+$';

/**
 * Mirrors `FileRefSchema` (`src/client/agent/task-schema.ts`); the WebView host returns it where a
 * `FileRef` is expected, so type checking catches a drift.
 */
export const NativeFileRefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128, pattern: IdentifierPattern }),
    name: Text(255),
    size: Type.Integer({ minimum: 0 }),
    type: Text(100),
  },
  { additionalProperties: false },
);
const Resources = Type.Object(
  { resources: Type.Array(NativeFileRefSchema, { maxItems: 10 }) },
  { additionalProperties: false },
);

/**
 * Mirrors agent-contracts `FolderRefSchema`: a folder the shell registered through
 * `/v1/folders/register`. The WebView host returns it where a `FolderRef` is expected, so type
 * checking catches a drift. `path` is the realpath, which the folder chip shows in its tooltip.
 */
export const NativeFolderRefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128, pattern: IdentifierPattern }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    path: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

/**
 * A path the shell could not import or register: its basename (a path reaches the page only in a
 * registered folder's ref) and the reason. `unreadable`, `unsupported` and `tooLarge` come from a
 * file import; `unreadable`, `notDirectory` and `forbidden` (a folder no task may read) from a
 * folder registration.
 */
export const ImportFailureSchema = Type.Object(
  {
    name: Text(255),
    reason: Type.Union([
      Type.Literal('unreadable'),
      Type.Literal('unsupported'),
      Type.Literal('tooLarge'),
      Type.Literal('notDirectory'),
      Type.Literal('forbidden'),
    ]),
  },
  { additionalProperties: false },
);

/** Longest base64 PNG `files.save` takes: 16 MiB of image, four characters per three bytes. */
export const MAX_SAVE_PNG_BASE64_LENGTH = Math.ceil((16 * 1024 * 1024) / 3) * 4;

/**
 * What `files.save` writes: text as UTF-8 (code, Markdown, SVG, a diagram's source), or a PNG as
 * base64. The file name carries the type for text; Swift checks a PNG's signature.
 */
export const SaveContentSchema = Type.Union([
  Type.Object(
    { type: Type.Literal('text'), text: Text(MAX_NATIVE_TEXT_LENGTH) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('png'),
      base64: Type.String({ minLength: 1, maxLength: MAX_SAVE_PNG_BASE64_LENGTH }),
    },
    { additionalProperties: false },
  ),
]);
export type SaveContent = Static<typeof SaveContentSchema>;

/** File calls; `calls.ts` spreads them into `NativeCalls`, whose answer rules they follow. */
export const NativeFileCalls = {
  /** Downloads the artifact through the service, then opens, reveals, or copies its path. */
  artifact: {
    params: Type.Object(
      {
        artifactId: Type.String({ minLength: 1, maxLength: 128 }),
        operation: Type.Union([
          Type.Literal('open'),
          Type.Literal('reveal'),
          Type.Literal('copyPath'),
        ]),
      },
      { additionalProperties: false },
    ),
    result: NativeFileRefSchema,
  },
  /** Open panel for attachments, imported through `/v1/resources/import`; `[]` when cancelled. */
  'files.pick': { params: Empty, result: Resources },
  /**
   * Open panel for folders (directories only, multiple selection), registered through
   * `/v1/folders/register`. Every pick lands in `folders` or `failures`; both are empty when the
   * user cancelled.
   */
  'files.pickFolder': {
    params: Empty,
    result: Type.Object(
      {
        folders: Type.Array(NativeFolderRefSchema, { maxItems: 10 }),
        failures: Type.Array(ImportFailureSchema, { maxItems: 10 }),
      },
      { additionalProperties: false },
    ),
  },
  /**
   * Save panel offering `content` under the suggested `name` (its basename, with `.png` for a PNG);
   * `saved` is false when the user cancelled or another save panel is open. A content Swift
   * refuses or a failed write rejects with a message in the shell's language.
   */
  'files.save': {
    params: Type.Object(
      { name: Type.String({ minLength: 1, maxLength: 255 }), content: SaveContentSchema },
      { additionalProperties: false },
    ),
    result: Type.Object({ saved: Type.Boolean() }, { additionalProperties: false }),
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;
