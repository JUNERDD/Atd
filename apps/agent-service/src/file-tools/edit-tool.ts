import {
  createEditToolDefinition,
  withFileMutationQueue,
  type AgentToolResult,
  type EditOperations,
  type EditToolDetails,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { resolveToolPath } from '../service-fs.js';
import { editDetails } from './edit-details.js';
import { applyEdits } from './edit-engine.js';
import type { EditEntry } from './matching.js';
import { textView } from './text-view.js';

/** pi's edit schema with `replaceAll` per entry; pi's descriptions otherwise. */
const editSchema = Type.Object(
  {
    path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
    edits: Type.Array(
      Type.Object(
        {
          oldText: Type.String({
            description:
              'Exact text for one targeted replacement. It must be unique in the original file, unless replaceAll is set, and must not overlap with any other edits[].oldText in the same call.',
          }),
          newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
          replaceAll: Type.Optional(
            Type.Boolean({
              description:
                'Replace every occurrence of oldText instead of requiring it to be unique, for renames and other repeated changes. Matches exact text only.',
            }),
          ),
        },
        {},
      ),
      {
        description:
          'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
      },
    ),
  },
  {},
);

const DESCRIPTION = [
  'Edit a single file using exact text replacement.',
  'Every edits[].oldText must match a unique, non-overlapping region of the original file; set replaceAll on an edit to change every occurrence of its oldText instead.',
  'If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits.',
  'Do not include large unchanged regions just to connect distant changes.',
  'The result shows the edited lines as they now read, so there is no need to read the file again to check the edit.',
].join(' ');

const BOM = '\uFEFF';

/** pi's render state for edit calls, which the reused pi renderers keep. */
type EditRenderState = Parameters<
  NonNullable<ReturnType<typeof createEditToolDefinition>['renderCall']>
>[2]['state'];

/** The edit tool: pi's definition with Atd's schema and matching engine. */
export type AtdEditToolDefinition = ToolDefinition<
  typeof editSchema,
  EditToolDetails | undefined,
  EditRenderState
>;

/**
 * A drop-in for pi's `createEditToolDefinition(cwd, { operations })`. pi's definition stays for
 * everything but the matching: its name, prompt snippet and guidelines, argument repair for legacy
 * shapes (`prepareArguments`) and renderers. Execution runs Atd's engine (edit-engine.ts) inside
 * pi's per-file mutation queue, keyed by the path pi resolves, so the read, the edit and the
 * write cannot interleave with another write to the file. Details keep pi's shape and diff format
 * (edit-details.ts), which transcript-details/edit.ts reads.
 */
export function createAtdEditToolDefinition(
  cwd: string,
  { operations }: { operations: EditOperations },
): AtdEditToolDefinition {
  const base = createEditToolDefinition(cwd, { operations });
  return {
    ...base,
    description: DESCRIPTION,
    parameters: editSchema,
    async execute(_toolCallId, input, signal, _onUpdate, ctx) {
      const { path, entries } = entriesOf(input);
      // pi falls back to its own cwd when a context names none.
      const absolutePath = resolveToolPath(ctx?.cwd || cwd, path);
      return withFileMutationQueue(absolutePath, () =>
        editFile(operations, absolutePath, path, entries, signal),
      );
    },
  };
}

/** pi's input check, with each entry's line breaks as LF as pi matches them. */
function entriesOf(input: Static<typeof editSchema>): { path: string; entries: EditEntry[] } {
  if (!Array.isArray(input.edits) || input.edits.length === 0)
    throw new Error('Edit tool input is invalid. edits must contain at least one replacement.');
  const entries = input.edits.map((edit) => ({
    oldText: toLf(edit.oldText),
    newText: toLf(edit.newText),
    replaceAll: edit.replaceAll === true,
  }));
  return { path: input.path, entries };
}

function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Reads, edits and writes one file, checking for an abort after every step as pi's edit does: an
 * abort never releases the mutation queue while a file operation is still in flight.
 */
async function editFile(
  operations: EditOperations,
  absolutePath: string,
  path: string,
  entries: readonly EditEntry[],
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<EditToolDetails | undefined>> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error('Operation aborted');
  };
  throwIfAborted();
  try {
    await operations.access(absolutePath);
  } catch (error) {
    throwIfAborted();
    throw new Error(accessFailure(path, error));
  }
  throwIfAborted();
  const content = (await operations.readFile(absolutePath)).toString('utf-8');
  throwIfAborted();
  // The model never types the invisible BOM: it is kept aside and written back.
  const bom = content.startsWith(BOM) ? BOM : '';
  const view = textView(content.slice(bom.length));
  const outcome = applyEdits(view, entries, path);
  const details = editDetails(path, view.lf, outcome.lf);
  throwIfAborted();
  await operations.writeFile(absolutePath, bom + outcome.text);
  throwIfAborted();
  return { content: [{ type: 'text', text: outcome.message }], details };
}

/** pi's message for a file edit cannot open, with a next step for a file that does not exist. */
function accessFailure(path: string, error: unknown): string {
  const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
  if (code === 'ENOENT')
    return `Could not edit ${path}: the file does not exist. Use write to create it.`;
  return `Could not edit file: ${path}. ${code === undefined ? String(error) : `Error code: ${code}`}.`;
}
