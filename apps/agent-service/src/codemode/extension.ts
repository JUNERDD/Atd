import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { createCodemodeExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { CODEMODE_TOOL } from '@atd/agent-contracts';
import { keepSpill, type SpillHost, type SpillKind } from '../spilled-output.js';
import { isRecord } from '../transcript-details/clamp.js';
import { NestedStepLog } from './steps.js';

/** Where a script's spilled output goes: the task's resources, a file the read tool reaches. */
export type CodemodeHost = SpillHost;

/** pi's spill of a script's output (`extensions/codemode/execute.js` `spillOutput`). */
const CODEMODE_SPILL: SpillKind = {
  file: /^pi-codemode-[0-9a-f]+\.txt$/,
  name: 'codemode-output.txt',
  mime: 'text/plain',
  label: 'Codemode output',
};

type Content = (TextContent | ImageContent)[];

/**
 * pi's `codemode` tool on the parent session, in mode `on`: declared tools stay declared, and
 * their descriptions say how a script calls them. Scripts get no `models` (classifiers and image
 * generation run on the session's credentials outside the app's tool approvals). Every nested
 * call runs through pi's tool pipeline, so each tool's own gate inside its `execute` asks, records
 * and refuses exactly as for a direct call; the run's allowlist and pi's exposure rules bound what
 * a script can reach, and tools whose state replays from their persisted results are model-only.
 *
 * Two things pi leaves to the host are settled when the codemode result is final:
 * - The nested calls' rows. pi persists no nested result, so the steps recorded from the
 *   `tool_call` / `tool_result` hooks (steps.ts) go into the result's details for the transcript.
 * - Output over the script's budget. pi spills the whole text to the system temp dir, which the
 *   read tool refuses and which outlives the task; it moves into the task's resources instead,
 *   and the result names the new file.
 */
export function codemodeExtension(host: CodemodeHost): ExtensionFactory {
  const register = createCodemodeExtension({ mode: 'on', models: false });
  return async (pi) => {
    await register(pi);
    const steps = new NestedStepLog();
    pi.on('tool_call', (event) => {
      if (event.parentToolCallId)
        steps.start(event.parentToolCallId, event.toolCallId, event.toolName, event.input);
    });
    pi.on('tool_result', async (event) => {
      if (event.parentToolCallId) {
        steps.end(event.toolCallId, event, event.isError);
        return undefined;
      }
      if (event.toolName !== CODEMODE_TOOL) return undefined;
      const list = steps.take(event.toolCallId) ?? { steps: [], truncated: false };
      const { fullOutputPath, ...details } = isRecord(event.details) ? event.details : {};
      const content =
        typeof fullOutputPath === 'string'
          ? await adoptSpill(host, fullOutputPath, event.content)
          : event.content;
      return {
        content,
        details: { ...details, steps: list.steps, stepsTruncated: list.truncated },
      };
    });
  };
}

/** Points the result at pi's spill file once the task's resources keep it (spilled-output.ts). */
async function adoptSpill(host: CodemodeHost, spilled: string, content: Content): Promise<Content> {
  const marker = `[Full output: ${spilled} (read with offset/limit)]`;
  const kept = await keepSpill(host, spilled, CODEMODE_SPILL);
  const replacement =
    kept === null
      ? '[Full output not kept]'
      : 'path' in kept
        ? `[Full output: ${kept.path} (read with offset/limit)]`
        : `[Could not save the full output: ${kept.error}]`;
  return content.map((part) =>
    part.type === 'text' ? { ...part, text: part.text.replaceAll(marker, replacement) } : part,
  );
}
