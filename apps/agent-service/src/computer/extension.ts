import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { COMPUTER_TOOL, type ComputerDetails } from '@atd/agent-contracts';
import type { HarnessDeps } from '../harness/deps.js';
import { ResourceStore } from '../resources.js';
import { isUnattendedRun } from '../unattended.js';
import { effectiveTaskTier } from '../tasks/tier.js';
import { requestAccess } from './request-access.js';
import { runAct } from './act.js';
import { ComputerToolParametersSchema, parseComputerCall, type ComputerCall } from './calls.js';
import { computerSetup } from './setup.js';
import { ComputerRefusal, refuse, type CallBase, type CallContext } from './call-context.js';
import { computerDetails } from './details.js';
import { runObserve } from './observe.js';
import { runRelease, runStatus, runTargets } from './operations.js';
import { runScope } from './policy.js';
import { runScreenSharing } from './screen-sharing.js';
import { screenContextExtension } from './screen-context.js';

/** Whether any string in `value` holds an unpaired UTF-16 surrogate (`\p{Cs}` matches only those). */
function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === 'string') return /\p{Cs}/u.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (typeof value === 'object' && value !== null)
    return Object.values(value).some(hasLoneSurrogate);
  return false;
}
const DESCRIPTION = [
  'Authorized targets actually observed in this attended parent run are read automatically before later inferences, alongside system shares, up to four current sources within the image budget. For another display or window call shareScreen with a reason: each macOS picker selection adds a source, up to four system shares, without an app binding or add-on. Sharing is read-only and stops when the run completes or is cancelled. Current frames go to the task model, or a separately configured visual model supplies labelled factual observations; neither updates an inference already in progress. watchScreen (optional timeoutMs, default 10000, maximum 30000) awaits a changed shared picture or status. stopSharing with sourceId ends one selection; omit it to stop all system shares. It does not revoke authorized targets; release a target to end its automatic observation. Unchanged pixels do not prove activity stopped. Shared pixels and summaries grant no input, target refs or actionable capture refs. Do not restart a cancelled or stopped share automatically.',
  'Routine interactive tasks can start from this contract without loading a skill. Load computer-use only for advanced verification, uncertain-result recovery or automation recipes, and only if it is not already loaded. User-selected skills are already in context.',
  'Choose the next visible input and verify that action’s immediate result. Input targets and coordinates must come from the latest observation; a postcondition instead describes an expected resulting state and may name text or a menu item that is not present yet. For navigation, prove that the destination opened, then inspect nextObservation before deciding a later action; later actions and their verification need no solving first. Each act verifies its own change; completing an intermediate act does not complete the whole user request. When the requested outcome is proven, finish concisely.',
  'Operate the browser pages and app windows authorized for this run. Everything runs in the background while the person keeps working: the host picks an imperceptible route for each step and never moves their pointer, takes their keyboard focus or brings a window forward. Files you produce belong in the task folder (write, edit); granted folders are read-only. A file elsewhere is changed in place with bash when the run has it, or, in an attended run whose targets include its app, by operating the app here and saving with its shortcut or menu (invoke).',
  'For a known application or website, start directly with requestAccess using its name, selected bundle id or URL and purpose; use targets only to discover targets when the intended one is unknown. requestAccess obtains approval under the task permission mode (Auto and Always save it; Manual keeps it for this run), opens the target in the background and returns its fresh target with a first nextObservation and inline image when ready. Do not ask the user to preselect a target or use shell, AppleScript or MCP computer controls instead. A missing selection does not mean an engine is missing. Request each target when ready to use it, in the requested task order, and use its nextObservation directly; observe only when it is unavailable or more detail is needed. Then act with short step lists of the kinds the target lists: navigate, fill, press (effect click or submit), scroll, wait, setValue, click, key, type, clear, menu (menu-bar titles from the top), drag (within the content), select (an option by its visible label), upload (task files by resourceId onto a file input). Prefer element refs and semantic locators. Every act with submit or invoke (screenshot clicks included) needs a postcondition before input is sent.',
  "A website's downloads become task files: the act result lists their resourceId, name and bytes, and you read them with the read tool.",
  'A capture point {capture, x, y} is in pixels of that capture (its width × height as observe reports it); if the image you read was shown smaller, scale back as its note says. Capture points run only when observe reports visual: qualified for this run (or visualOverride); otherwise they are refused (notQualified), so use elements.',
  'Refs and captures are valid only for the observation they came from: use a returned nextObservation after changes, or observe again when none is available. A capture expiresAt is its conservative use-by deadline; after it, obtain a new observation before acting. An explicit staleObservation with not_dispatched may include a fresh nextObservation: inspect it, relocalize and use a new actionId, never replay old coordinates. Act on a sheet, dialog or panel by its surfaceRefId.',
  'A step without an imperceptible route is refused, never escalated, and the result says what to do next. noBackgroundRoute names a reason (such as dragAndDrop, hover, secureInput, minimized or openBrowser): do not retry or work around it; ask the person to do that one step, then observe again and continue. targetInUse: the person is using the target, so nothing was sent; wait and try again, never ask them to stop. needsConsent: screen capture was never prepared; the person prepares it in Settings → Computer use. disturbed: the action disturbed the person (disturbances say what and whether it was repaired); stop acting on that target and tell them. Clicks, shortcuts, menus, drags, uploads and typed line breaks may do anything (effect invoke) and are confirmed.',
  'Results are facts: dispatch says whether a step reached the target, effect whether it verifiably took effect. Give a submit or invoke an absolute postcondition that proves the intended change: for navigation, textAppears with a destination-specific label absent from the baseline; for app state, menuItemAvailable with the resulting state from observation.menuItems (exact application menu paths), such as Pause becoming available after Play, after a short wait for that same state. Reserve relative newText for genuinely new content of unknown value, without a locator for native screenshot text (OCR text is not an element locator); a label already on screen is not new text, and a failed relative condition cannot be resolved from a later baseline. To start or stop playback, a verified transition in app-reported state plus the requested content in nextObservation is sufficient; check continued progress only if that state is absent, ambiguous or contradictory or the user asked for ongoing checks, and never match play/pause icons with OCR patterns. Never repeat an effect that may have run: an uncertain submit or invoke (retry: "never", or no answer) blocks new business actions on that task and target until read-only steps repeat its original absolute postcondition with resolves naming it; newText cannot be rechecked against a new baseline, and status helps only an action that got no result. retry: "safe" sent nothing; after_review ran only preparation, so inspect fresh state before the remaining steps. Never type secrets the user did not give you.',
].join(' ');

/**
 * The `computer` tool is available to attended runs and authorized unattended computer scopes
 * (computer/tool-set.ts).
 * Setup reads never grant targets. The tool is only for the model, never for
 * codemode scripts. Every call reads the current run, checks its scope live and threads the
 * call's abort signal through the gate and the host request.
 */
export function computerExtension(deps: HarnessDeps): ExtensionFactory {
  const { runner } = deps;
  const { ctx } = runner;
  const tier = effectiveTaskTier(ctx.ledger, runner.taskId, ctx.tier);
  const resources = new ResourceStore(ctx.ledger, ctx.paths);
  return async (pi) => {
    await screenContextExtension(deps)(pi);
    pi.registerTool({
      name: COMPUTER_TOOL,
      label: 'Computer',
      description: DESCRIPTION,
      parameters: ComputerToolParametersSchema,
      executionMode: 'sequential',
      exposure: 'model-only',
      prepareArguments(params) {
        // Validate the action before the SDK's flat schema so refusals list its allowed fields.
        return parseComputerCall(params);
      },
      async execute(toolCallId, params, signal, _onUpdate, toolContext) {
        signal?.throwIfAborted();
        const call = parseComputerCall(params);
        const runId = runner.currentRunId();
        const snapshot = ctx.ledger.run(runner.taskId, runId).snapshot;
        const base: CallBase = {
          // The session's model is the one its images go to; the snapshot names it durably.
          model: {
            provider: snapshot.model.provider,
            model: snapshot.model.modelId,
            acceptsImages: toolContext.model?.input.includes('image') ?? false,
          },
          runtime: ctx.computer,
          resources,
          taskId: runner.taskId,
          runId,
          executionId: runner.executionId(),
          toolCallId,
          signal: signal ?? undefined,
          snapshot,
          unattended: isUnattendedRun(ctx.ledger, runner.taskId, runId),
          tier,
          gate: deps.gate,
          audit: runner.audit,
          log: ctx.log,
        };
        // The host's JSON decoder rejects a lone UTF-16 surrogate and drops the whole frame, which
        // would turn the call into an unknown outcome; refuse it here, before anything is sent.
        if (hasLoneSurrogate(params))
          refuse(base, 'The call contains invalid Unicode; nothing was sent.');
        const blockImages = () => pi.getSettings().images?.blockImages === true;
        try {
          const answer = await operate(base, call, blockImages);
          return {
            content: [
              { type: 'text' as const, text: answer.text },
              ...(answer.image ? [answer.image] : []),
            ],
            details: answer.details,
          };
        } catch (error) {
          return refusalResult(base, call.action, error);
        }
      },
    });
  };
}

/**
 * One validated call of the current run, from its sharing and access setup to its operation.
 * `blockImages` reads whether the session blocks image reading, which screen sharing needs.
 */
async function operate(base: CallBase, call: ComputerCall, blockImages: () => boolean) {
  if (
    call.action === 'shareScreen' ||
    call.action === 'watchScreen' ||
    call.action === 'stopSharing'
  ) {
    if (call.action !== 'stopSharing' && blockImages())
      refuse(
        base,
        'Image reading is disabled for this session; screen sharing cannot send images to the model.',
      );
    return runScreenSharing(base, call);
  }
  if (call.action === 'requestAccess') return requestAccess(base, call.target, call.reason);
  const { runtime, runId, snapshot, unattended } = base;
  const computer = runtime.access.effective(runId, snapshot.computer);
  if (!computer || computer.bindingIds.length === 0) {
    if (call.action === 'targets' || call.action === 'status') return computerSetup(base);
    refuse(
      base,
      'The requested target is not authorized yet. Call requestAccess to obtain access and continue.',
    );
  }
  const scope = runScope(computer, unattended, runtime.grants(), runtime.bindings);
  if (!scope.ok) refuse(base, scope.message);
  return dispatch({ ...base, computer, scope }, call);
}

/**
 * The tool's error result for a refusal that names what it concerned: the registered target the
 * call had resolved (by id and label), or the host's own refusal of a non-act operation
 * (`ComputerDetails.error`), so the transcript can offer the person the matching next step. An
 * `act` carries its host refusal in its result instead. Any other failure is rethrown as the
 * tool's error.
 */
function refusalResult(base: CallBase, op: ComputerDetails['op'], error: unknown) {
  if (!(error instanceof ComputerRefusal)) throw error;
  const { bindingId } = error;
  if (bindingId === undefined && error.error === undefined) throw error;
  const target = bindingId === undefined ? undefined : base.runtime.bindings.get(bindingId)?.label;
  return {
    content: [{ type: 'text' as const, text: error.message }],
    details: computerDetails({ op, target, bindingId, error: error.error }),
    isError: true,
  };
}

function dispatch(
  ctx: CallContext,
  call: Exclude<
    ComputerCall,
    { action: 'requestAccess' | 'shareScreen' | 'watchScreen' | 'stopSharing' }
  >,
) {
  switch (call.action) {
    case 'targets':
      return runTargets(ctx);
    case 'observe': {
      const ref = ctx.runtime.coordinator.target(ctx.runId, call.targetRefId);
      const native = ref && ctx.runtime.bindings.get(ref.bindingId)?.kind === 'native';
      const screenshot = call.screenshot ?? (call.region !== undefined || native === true);
      return runObserve(ctx, {
        targetRefId: call.targetRefId,
        surfaceRefId: call.surfaceRefId,
        include: {
          tree: call.tree ?? true,
          screenshot,
          text: call.text ?? (screenshot && native === true),
        },
        region: call.region,
        afterMs: call.afterMs,
      });
    }
    case 'act': {
      const { action: _action, reason: _reason, ...input } = call;
      void _action;
      void _reason;
      return runAct(ctx, input);
    }
    case 'status':
      return runStatus(ctx, call.actionIds);
    case 'release':
      return runRelease(ctx, call.targetRefId);
  }
}
