import {
  errorMessage,
  parse,
  snapshotToolsFor,
  SubmitTaskRequestSchema,
  type Automation,
  type AutomationRun,
  type AutomationRunReason,
  type FileRef,
  type ServiceCommandFull,
  type SubmitTaskResponse,
  type TaskInput,
} from '@atd/agent-contracts';
import { CommandLaunchError, type LaunchCommandRequest } from '../commands/launch.js';
import type { FolderStore } from '../folders/store.js';
import { DrainingError } from '../errors.js';
import { checkFolder } from '../folders/check.js';
import { LedgerNotFound } from '../ledger.js';
import type { ResourceStore } from '../resources.js';
import { importResources } from '../resources/import.js';
import type { InternalSubmitOptions } from '../tasks/submit-options.js';
import { templateReferences } from '../commands/templates.js';
import { commandRefusal, folderRegistered, lookups, runModel } from './checks.js';
import type { AutomationRuns } from './engine-deps.js';
import { finalAnswer } from './outcome.js';
import { automationFrame, automationPrompt, runTitle, type FireFacts } from './prompt.js';
import { oneLine } from './untrusted.js';

/**
 * Starts the task run of one automation fire through the same acceptance path a manual run takes:
 * `RunnerManager.submit` for a prompt, the service-side `launchCommand` for a saved command. A
 * preflight refuses before any model call when the model, the command or a folder no longer
 * resolves; the engine then records a failed run without a task (decision D4).
 */

/** What a prompt run may use when the automation names no tools: reading and file edits, no shell. */
const PROMPT_TOOLS = snapshotToolsFor(['read', 'write', 'edit']);

/** `launchCommand` bound to the service's paths, ledger and manager. */
export type CommandLauncher = (
  request: LaunchCommandRequest,
  internal: InternalSubmitOptions,
) => Promise<SubmitTaskResponse>;

export interface LaunchDeps {
  dataDir: string;
  manager: Pick<AutomationRuns, 'submit' | 'snapshot'>;
  launchCommand: CommandLauncher;
  folders: Pick<FolderStore, 'resolve'>;
  resources: Pick<ResourceStore, 'save'>;
}

/** A run that could not start, with the reason its record fails with. */
export class LaunchFailure extends Error {
  constructor(
    readonly reason: AutomationRunReason,
    message: string,
  ) {
    super(message);
    this.name = 'LaunchFailure';
  }
}

export interface LaunchRequest {
  automation: Automation;
  /** The durable receipt of this fire. */
  record: AutomationRun;
  /** The task the run creates, generated before the receipt so a retry finds it. */
  taskId: string;
  facts: FireFacts;
  /** Folder runs: the absolute paths of the files that fired it. */
  filePaths: readonly string[];
  /** The last delivered run, whose answer a prompt run reads as `<previous-result>`. */
  previous: { taskId: string; runId: string } | null;
}

/** The deterministic idempotency key of a fire (decision D6). */
export function operationIdFor(automationId: string, recordId: string): string {
  return `auto_${automationId}_${recordId}`;
}

/** Registered folders every run may read: the policy's, plus a folder trigger's own. */
export function runFolderIds(automation: Automation): string[] {
  const ids = [...automation.policy.folderIds];
  if (automation.trigger.kind === 'folder') ids.push(automation.trigger.folderId);
  return [...new Set(ids)];
}

/** Starts the run; throws a `LaunchFailure`, or the manager's `DrainingError` while it drains. */
export async function launchRun(
  deps: LaunchDeps,
  request: LaunchRequest,
): Promise<SubmitTaskResponse> {
  const { automation, record } = request;
  const folders = runFolderIds(automation);
  const saved = lookups(deps.dataDir);
  if (!(await foldersReadable(deps, folders)))
    throw new LaunchFailure('folderUnavailable', 'A folder of the automation cannot be read.');
  const { action } = automation;
  const command = action.kind === 'command' ? await saved.command(action.commandId) : null;
  if (!(await saved.modelAvailable(runModel(automation, command))))
    throw new LaunchFailure('modelUnavailable', 'No provider connection can run the automation.');
  const internal: InternalSubmitOptions = {
    origin: { kind: 'automation', automationId: automation.id },
    permissionTier: automation.policy.permissionTier,
    title: runTitle(automation, Date.parse(record.firedAt)),
    trigger: {
      kind: 'automation',
      automationId: automation.id,
      automationRunId: record.id,
      source: record.source,
      firedAt: record.firedAt,
    },
  };
  try {
    return automation.action.kind === 'prompt'
      ? await submitPrompt(deps, request, automation.action.prompt, folders, internal)
      : await submitCommand(deps, request, folders, internal, command);
  } catch (error) {
    throw launchFailure(error);
  }
}

/** Whether every folder is registered and still the readable directory it was registered as. */
async function foldersReadable(deps: LaunchDeps, ids: readonly string[]): Promise<boolean> {
  for (const id of ids) {
    if (!folderRegistered(deps.folders, id)) return false;
    const [folder] = deps.folders.resolve([id]);
    const checked = folder ? await checkFolder(folder.path, deps.dataDir) : null;
    if (!checked?.ok || checked.real !== folder?.path) return false;
  }
  return true;
}

function baseInput(text: string, firedAt: string, folders: string[]): TaskInput {
  return {
    text,
    source: 'manual',
    capturedAt: firedAt,
    selection: '',
    clipboard: '',
    files: [],
    arguments: {},
    // Plain text: an automation's prompt never turns into skill chips.
    chips: [],
    folders,
  };
}

async function submitPrompt(
  deps: LaunchDeps,
  request: LaunchRequest,
  prompt: string,
  folders: string[],
  internal: InternalSubmitOptions,
): Promise<SubmitTaskResponse> {
  const { automation, record } = request;
  const previous = await wantedPrevious(deps, request);
  const text = automationPrompt(automation, prompt, request.facts, previous);
  const { policy } = automation;
  const submit = parse(SubmitTaskRequestSchema, {
    operationId: operationIdFor(automation.id, record.id),
    taskId: request.taskId,
    input: baseInput(text, record.firedAt, folders),
    ...(policy.model ? { model: policy.model } : {}),
    ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
    tools: policy.tools ?? PROMPT_TOOLS,
    memory: policy.memory,
  });
  return deps.manager.submit(submit, internal);
}

async function submitCommand(
  deps: LaunchDeps,
  request: LaunchRequest,
  folders: string[],
  internal: InternalSubmitOptions,
  command: ServiceCommandFull | null,
): Promise<SubmitTaskResponse> {
  const { automation, record } = request;
  if (automation.action.kind !== 'command') throw new TypeError('Not a command action.');
  const action = automation.action;
  const refusal = commandRefusal(command, action, automation.trigger);
  if (!command || refusal)
    throw new LaunchFailure('commandUnavailable', refusal ?? 'The command no longer exists.');
  // `{{files}}` reads files as resources; a command without file input gets none. Files the
  // attachment rules refuse (a PDF, an archive) reach the run by path in its trigger data.
  const { files, unattached } = command.input.files
    ? await importFiles(deps, request.filePaths)
    : { files: [], unattached: [] };
  const needsFiles = templateReferences(command.instructions).some((ref) => ref.name === 'files');
  if (needsFiles && request.filePaths.length && !files.length)
    throw new LaunchFailure(
      'unsupportedFiles',
      'None of the files that fired it can be attached to the command.',
    );
  const facts = unattached.length ? { ...request.facts, unattached } : request.facts;
  const { policy } = automation;
  const previous = await wantedPrevious(deps, request);
  return deps.launchCommand(
    {
      commandId: action.commandId,
      operationId: operationIdFor(automation.id, record.id),
      taskId: request.taskId,
      input: {
        ...baseInput(action.input, record.firedAt, folders),
        files,
        arguments: action.arguments,
      },
      // The same context, previous answer and trigger data a prompt run reads, around the template.
      frame: automationFrame(automation, facts, previous),
      policy: {
        ...(policy.model ? { model: policy.model } : {}),
        ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
        memory: policy.memory,
      },
    },
    internal,
  );
}

/**
 * Stores the files as resources, named on one line with no brackets (untrusted.ts): the command
 * lists them in its own text, which the reviewer reads as the person's words. Files the
 * attachment rules refuse come back by path.
 */
async function importFiles(
  deps: LaunchDeps,
  paths: readonly string[],
): Promise<{ files: FileRef[]; unattached: string[] }> {
  if (!paths.length) return { files: [], unattached: [] };
  const { imported, failures } = await importResources(deps.resources, [...paths]);
  const files = imported.map(({ resource }) => ({
    id: resource.id,
    name: oneLine(resource.name, 255),
    size: resource.size,
    type: resource.mime,
  }));
  return { files, unattached: failures.map((failure) => failure.path) };
}

/** The last delivered answer, when the automation gives each run the previous result. */
async function wantedPrevious(deps: LaunchDeps, request: LaunchRequest): Promise<string | null> {
  const { previous, automation } = request;
  if (!previous || !automation.delivery.includePreviousResult) return null;
  try {
    return (
      finalAnswer((await deps.manager.snapshot(previous.taskId)).blocks, previous.runId) || null
    );
  } catch {
    // The task was deleted: there is no previous answer to compare with.
    return null;
  }
}

/** The reason a refused launch records; drains pass through for the engine to tell apart. */
function launchFailure(error: unknown): unknown {
  if (error instanceof LaunchFailure) return error;
  if (error instanceof CommandLaunchError)
    return new LaunchFailure('commandUnavailable', error.message);
  if (error instanceof LedgerNotFound && error.kind === 'Connection')
    return new LaunchFailure('modelUnavailable', error.message);
  if (error instanceof DrainingError) return error;
  return new LaunchFailure('submitFailed', errorMessage(error));
}
