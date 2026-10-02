import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { createCodemodeExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { CODEMODE_TOOL, errorMessage } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import { isRecord } from '../transcript-details/clamp.js';
import { NestedStepLog } from './steps.js';

/** Where a script's spilled output goes: the task's resources, a file the read tool reaches. */
export interface CodemodeHost {
  taskId: string;
  resources: Pick<ResourceStore, 'save'>;
  /** The resource store's directory; a saved resource's file is `<resourcesDir>/<id>`. */
  resourcesDir: string;
  log: Pick<Logger, 'warn'>;
}

/** pi's spill file name (`extensions/codemode/execute.js` `spillOutput`). */
const SPILL_FILE = /^pi-codemode-[0-9a-f]+\.txt$/;

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

/**
 * Moves pi's spill file into the task's resources and points the result at it; the temp file is
 * removed either way. Only pi's own spill file in the system temp dir is read.
 */
async function adoptSpill(host: CodemodeHost, spilled: string, content: Content): Promise<Content> {
  const marker = `[Full output: ${spilled} (read with offset/limit)]`;
  const rewrite = (replacement: string) =>
    content.map((part) =>
      part.type === 'text' ? { ...part, text: part.text.replaceAll(marker, replacement) } : part,
    );
  const resolved = path.resolve(spilled);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !SPILL_FILE.test(path.basename(resolved))
  )
    return rewrite('[Full output not kept]');
  try {
    const resource = await host.resources.save({
      name: 'codemode-output.txt',
      mime: 'text/plain',
      bytes: new Uint8Array(await readFile(resolved)),
      taskId: host.taskId,
    });
    const kept = path.join(host.resourcesDir, resource.id);
    return rewrite(`[Full output: ${kept} (read with offset/limit)]`);
  } catch (error) {
    host.log.warn('Codemode output could not be kept.', {
      taskId: host.taskId,
      error: errorMessage(error),
    });
    return rewrite(`[Could not save the full output: ${errorMessage(error)}]`);
  } finally {
    await rm(resolved, { force: true });
  }
}
