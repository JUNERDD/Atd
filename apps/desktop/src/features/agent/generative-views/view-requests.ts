import {
  ViewErrorCode,
  ViewMessageParamsSchema,
  ViewOpenLinkParamsSchema,
} from '@atd/agent-contracts';
import type { InputRequest } from '../../../client/agent/permission-schema';
import { emptyInput } from '../../../client/agent/task-schema';
import i18n from '../../../i18n';
import { messageOf } from '../../../lib/errors';
import { agentApi } from '../use-agent';
import {
  paramsOf,
  rpcError,
  rpcResult,
  webLink,
  type RpcId,
  type RpcOutbound,
} from './view-protocol';

/**
 * What a view's window may do on the user's behalf: send a message to the agent (`ui/message`)
 * and open a web link (`ui/open-link`). Both need the user to be engaged with the view's frame, so
 * a view cannot act by itself while the user is elsewhere, and both are rate-limited per view. A
 * widget may do neither (`refuseInWidget`): it only shows, and the user acts in the window.
 */

/** The pointer still counts as on the frame this long after it left it. */
const LEFT_GRACE_MS = 2_000;
/** The shortest gap between two accepted requests of one kind from one view. */
const MIN_GAP_MS = 1_000;
/** The most requests of one kind one view may have accepted within a minute. */
const PER_MINUTE = 10;
const MINUTE_MS = 60_000;

export interface Engagement {
  /** The frame holds focus, the pointer is over it, or it left less than two seconds ago. */
  engaged: () => boolean;
  stop: () => void;
}

/** Follows whether the user engages `frame`, until `stop`. */
export function watchEngagement(frame: HTMLIFrameElement): Engagement {
  let over = false;
  let leftAt = Number.NEGATIVE_INFINITY;
  const enter = () => {
    over = true;
  };
  const leave = () => {
    if (!over) return;
    over = false;
    leftAt = performance.now();
  };
  // Over the frame, pointer events go to the view's document, so any the page sees elsewhere also
  // ends a hover whose `pointerleave` the engine did not deliver.
  const elsewhere = (event: PointerEvent) => {
    if (event.target !== frame) leave();
  };
  frame.addEventListener('pointerenter', enter);
  frame.addEventListener('pointerleave', leave);
  document.addEventListener('pointerover', elsewhere, true);
  return {
    engaged: () =>
      document.activeElement === frame || over || performance.now() - leftAt < LEFT_GRACE_MS,
    stop: () => {
      frame.removeEventListener('pointerenter', enter);
      frame.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointerover', elsewhere, true);
    },
  };
}

type Refusal = 'engage' | 'tooSoon' | 'tooMany';

const REFUSALS = {
  engage: 'tasks:view.refused.engage',
  tooSoon: 'tasks:view.refused.tooSoon',
  tooMany: 'tasks:view.refused.tooMany',
} as const satisfies Record<Refusal, string>;

/** When each view's requests were accepted in the last minute, by view key and request kind. */
const accepted = new Map<string, number[]>();

/** Accepts a request when the user is engaged and the view keeps to its rate; records it then. */
function admit(gate: string, engaged: boolean, now: number): Refusal | null {
  if (!engaged) return 'engage';
  const recent = (accepted.get(gate) ?? []).filter((at) => now - at < MINUTE_MS);
  const last = recent.at(-1);
  if (last !== undefined && now - last < MIN_GAP_MS) return 'tooSoon';
  if (recent.length >= PER_MINUTE) return 'tooMany';
  accepted.set(gate, [...recent, now]);
  return null;
}

/**
 * Delivers a view's message. A pending input request on the view's call (a waiting view) takes it
 * as the answer and the agent continues its turn; otherwise it is the user's next message in the
 * task, which starts a run when the task is idle and queues as a follow-up while one is active.
 */
async function deliver(taskId: string, text: string, request: InputRequest | undefined) {
  if (request) {
    await agentApi().answer(request.taskId, request.runId, request.id, { answer: text });
    return;
  }
  await agentApi().submit({
    invocationId: crypto.randomUUID(),
    taskId,
    commandId: null,
    commandRevision: null,
    savedRun: null,
    input: { ...emptyInput(), text, chips: [] },
    policy: null,
  });
}

/** Where a view's request came from, read when it arrived. */
export interface RequestScope {
  /** The view's key (`viewKey`). */
  key: string;
  taskId: string;
  /** The pending input request on the view's call, while it waits. */
  request: InputRequest | undefined;
  /** Whether the user was engaged with the frame when the request arrived. */
  engaged: boolean;
}

/** Answers a widget's `ui/message` or `ui/open-link`: refused, since the user acts in the window. */
export function refuseInWidget(id: RpcId): RpcOutbound {
  return rpcError(id, ViewErrorCode.refused, i18n.t('tasks:view.refused.widget'));
}

/** Answers a view's `ui/message`: `{}` once the message is delivered, an error otherwise. */
export async function answerMessage(
  id: RpcId,
  params: unknown,
  scope: RequestScope,
): Promise<RpcOutbound> {
  const text = paramsOf(ViewMessageParamsSchema, params)?.content[0]?.text.trim();
  if (!text) return rpcError(id, ViewErrorCode.invalidParams, i18n.t('tasks:view.refused.empty'));
  const refusal = admit(`${scope.key} message`, scope.engaged, Date.now());
  if (refusal) return rpcError(id, ViewErrorCode.refused, i18n.t(REFUSALS[refusal]));
  try {
    await deliver(scope.taskId, text, scope.request);
    return rpcResult(id, {});
  } catch (error) {
    return rpcError(id, ViewErrorCode.refused, messageOf(error));
  }
}

/** Answers a view's `ui/open-link`: `{}` once the browser opens the link, an error otherwise. */
export async function answerOpenLink(
  id: RpcId,
  params: unknown,
  scope: RequestScope,
): Promise<RpcOutbound> {
  const url = paramsOf(ViewOpenLinkParamsSchema, params)?.url;
  const href = url === undefined ? null : webLink(url);
  if (!href) return rpcError(id, ViewErrorCode.invalidParams, i18n.t('tasks:view.refused.link'));
  const refusal = admit(`${scope.key} link`, scope.engaged, Date.now());
  if (refusal) return rpcError(id, ViewErrorCode.refused, i18n.t(REFUSALS[refusal]));
  try {
    await agentApi().openLink(href);
    return rpcResult(id, {});
  } catch (error) {
    return rpcError(id, ViewErrorCode.refused, messageOf(error));
  }
}
