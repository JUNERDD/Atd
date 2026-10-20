import type { Api, ImageContent, Model, TextContent } from '@earendil-works/pi-ai';
import type { ContextEvent, ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';
import { isRequestTooLarge } from '@atd/agent-contracts';
import { imageBytes, messageImages } from '../message-images.js';

type AgentMessage = ContextEvent['messages'][number];

/** Image bytes a request may carry before the oldest images are cut, and what a cut leaves. */
interface ImageBudget {
  trigger: number;
  target: number;
}

const MiB = 1024 * 1024;
/**
 * For a model without a declared request size. OpenAI-compatible gateways often cap bodies far
 * below the providers' own limits, so history images stay at a few megabytes; a live screen
 * frame (computer/vision-images.ts) comes on top of this.
 */
const DEFAULT_BUDGET: ImageBudget = { trigger: 6 * MiB, target: 3 * MiB };
/** After a refused body for this model: about the newest image, then none at all. */
const TIGHT_BUDGET: ImageBudget = { trigger: 1 * MiB, target: MiB / 2 };
const NO_IMAGES: ImageBudget = { trigger: 0, target: 0 };
/** Levels past the model's own budget: tight, then no images. */
const LEVELS = 2;

const REMOVED_IMAGE_TEXT =
  "[Image removed from this request to keep it within the model provider's size limit. You " +
  'cannot see it now, so do not describe it from memory. If you need it, read its file again ' +
  'from the path given with it, or capture it again.]';
const REMOVED_IMAGE: TextContent = { type: 'text', text: REMOVED_IMAGE_TEXT };

/**
 * Bounds the image bytes of every model request and recovers a request the provider refused as
 * too large (HTTP 413). Pi re-sends every history image on each request, so a long chat with
 * screenshots grows past what a provider or gateway accepts, and that request fails on every
 * later turn too.
 *
 * Budget (`context`): once the images pass the budget's trigger, the oldest are replaced by a
 * placeholder until they fit below its target. The cut only moves after another
 * (trigger − target) bytes of images arrive, so the prompt-cache prefix stays stable between
 * cuts. Only the request changes; the session file keeps every image.
 *
 * Recovery: each refused request for the session's model tightens its budget one level, read
 * back from the session's own failed messages, so the tighter budget outlives a service restart
 * and later turns never replay the refused size. Once per prompt, when the request still had
 * images to drop, the failed attempt is omitted from context (as Pi's own retry does) and the
 * request is sent again at the tighter level. A retry that fails as well ends the run with the
 * provider's error, which the renderer explains (`isRequestTooLarge`).
 */
export function imageBudgetExtension(pi: ExtensionAPI): void {
  let retried = false;
  pi.on('context', (event, ctx) => {
    if (!ctx.model) return undefined;
    const level = refusedRequests(ctx.sessionManager.getBranch(), ctx.model);
    const drop = imagesToDrop(event.messages, budgetFor(ctx.model, level));
    if (!drop.size) return undefined;
    return { messages: event.messages.map((message) => withoutImages(message, drop)) };
  });
  pi.on('agent_before_settle', (event, ctx) => {
    if (retried || event.outcome !== 'error' || !ctx.model) return undefined;
    const failed = event.context.contextEntries.at(-1);
    const [message] = failed?.messages ?? [];
    if (
      failed?.sourceEntry.type !== 'message' ||
      message?.role !== 'assistant' ||
      message.stopReason !== 'error' ||
      !isRequestTooLarge(message.errorMessage ?? '')
    )
      return undefined;
    // Only a failure that tightened this model's budget is worth sending again: a body too large
    // without images, or one already sent without any, fails the same way.
    const level = refusedRequests(ctx.sessionManager.getBranch(), ctx.model);
    const images = event.context.contextMessages.some((entry) => messageImages(entry).length);
    if (level === 0 || level > LEVELS || !images) return undefined;
    retried = true;
    return {
      entries: [
        ...event.entries,
        { type: 'context_edit', targetId: failed.sourceEntry.id, replacement: null },
      ],
      continue: true,
    };
  });
  pi.on('agent_settled', () => {
    retried = false;
  });
}

function budgetFor(model: Model<Api>, level: number): ImageBudget {
  const max = model.inputLimits?.maxRequestBytes;
  const base = max ? { trigger: Math.floor(max / 2), target: Math.floor(max / 4) } : DEFAULT_BUDGET;
  if (level <= 0) return base;
  if (level === 1)
    return {
      trigger: Math.min(base.trigger, TIGHT_BUDGET.trigger),
      target: Math.min(base.target, TIGHT_BUDGET.target),
    };
  return NO_IMAGES;
}

/** How many requests to this model the session saw refused as too large. */
function refusedRequests(branch: readonly SessionEntry[], model: Model<Api>): number {
  let count = 0;
  for (const entry of branch) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
    const { message } = entry;
    if (
      message.stopReason === 'error' &&
      message.provider === model.provider &&
      message.model === model.id &&
      isRequestTooLarge(message.errorMessage ?? '')
    )
      count += 1;
  }
  return count;
}

/**
 * The oldest images to cut. The bytes owed are the overshoot past the trigger rounded up to whole
 * (trigger − target) steps, so the same images go until the total crosses the next step, and what
 * stays is never above the trigger.
 */
function imagesToDrop(messages: readonly AgentMessage[], budget: ImageBudget): Set<ImageContent> {
  const images = messages.flatMap((message) => messageImages(message));
  const total = images.reduce((sum, image) => sum + imageBytes(image), 0);
  if (total <= budget.trigger) return new Set();
  if (budget.trigger <= 0) return new Set(images);
  const step = Math.max(1, budget.trigger - budget.target);
  const owed = Math.ceil((total - budget.trigger) / step) * step;
  const drop = new Set<ImageContent>();
  let dropped = 0;
  for (const image of images) {
    if (dropped >= owed) break;
    drop.add(image);
    dropped += imageBytes(image);
  }
  return drop;
}

function withoutImages(message: AgentMessage, drop: ReadonlySet<ImageContent>): AgentMessage {
  const replace = (content: (TextContent | ImageContent)[]) =>
    content.map((part) => (part.type === 'image' && drop.has(part) ? REMOVED_IMAGE : part));
  switch (message.role) {
    case 'user':
    case 'custom':
      return typeof message.content === 'string'
        ? message
        : { ...message, content: replace(message.content) };
    case 'toolResult':
      return { ...message, content: replace(message.content) };
    case 'assistant':
    case 'bashExecution':
    case 'branchSummary':
    case 'compactionSummary':
    case 'system':
      return message;
  }
}
