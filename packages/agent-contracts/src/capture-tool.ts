import { Type, type Static } from 'typebox';
import type {
  CaptureAnswer,
  CaptureAnswerAction,
  CaptureAnswerItem,
  CaptureBounds,
  CaptureParagraph,
} from './capture-answer.js';

/** Paragraphs one run on screenshot text reads at most: a long screenshot's whole text fits. */
export const MAX_SCREENSHOT_TEXT_PARAGRAPHS = 4000;

export const CaptureMarkToolSchema = Type.Union([
  Type.Literal('replace'),
  Type.Literal('step'),
  Type.Literal('highlight'),
  Type.Literal('box'),
  Type.Literal('ellipse'),
  Type.Literal('arrow'),
  Type.Literal('spotlight'),
  Type.Literal('mosaic'),
]);
export type CaptureMarkTool = Static<typeof CaptureMarkToolSchema>;

export const MarkScreenshotItemSchema = Type.Object(
  {
    tool: CaptureMarkToolSchema,
    paragraph: Type.Optional(Type.String()),
    phrase: Type.Optional(Type.String()),
    point: Type.Optional(
      Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false }),
    ),
    coords: Type.Optional(
      Type.Object(
        { x1: Type.Number(), y1: Type.Number(), x2: Type.Number(), y2: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    text: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MarkScreenshotParamsSchema = Type.Object(
  {
    lead: Type.Optional(Type.String()),
    items: Type.Array(MarkScreenshotItemSchema, {
      minItems: 1,
      maxItems: MAX_SCREENSHOT_TEXT_PARAGRAPHS,
    }),
  },
  { additionalProperties: false },
);
export type MarkScreenshotParams = Static<typeof MarkScreenshotParamsSchema>;

/** Where `phrase` is in `text`, tolerating wrapped whitespace; undefined falls back to whole paragraph. */
function located(text: string, phrase: string | undefined): string | undefined {
  if (!phrase?.trim()) return undefined;
  if (text.includes(phrase)) return phrase;
  const words = phrase
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(words.join('\\s+')).exec(text)?.[0];
}

/** Scales `0..1` float decimals to `0..1000`, then rounds and clamps every coordinate to `[0, 1000]`. */
function normalizeNums(raw: unknown, keys: readonly string[]): number[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const nums = keys.map((k) => (raw as Record<string, unknown>)[k]);
  if (!nums.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) return null;
  const unit = nums.some((n) => !Number.isInteger(n)) && nums.every((n) => n >= 0 && n <= 1);
  return nums.map((n) => Math.min(1000, Math.max(0, Math.round(unit ? n * 1000 : n))));
}

function asBounds(raw: unknown): CaptureBounds | null {
  const n = normalizeNums(raw, ['x1', 'y1', 'x2', 'y2']);
  return n ? { x1: n[0] ?? 0, y1: n[1] ?? 0, x2: n[2] ?? 0, y2: n[3] ?? 0 } : null;
}

const VALID_TOOLS = new Set<string>(CaptureMarkToolSchema.anyOf.map((s) => s.const));
type ItemResult = { ok: true; item: CaptureAnswerItem } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const okItem = (item: CaptureAnswerItem): ItemResult => ({ ok: true, item });

function normalizeVisualItem(
  tool: CaptureMarkTool,
  rec: Record<string, unknown>,
  text: string,
): ItemResult {
  if (tool === 'replace' || tool === 'highlight')
    return fail(`Tool "${tool}" requires a known "paragraph" id.`);
  const bounds = asBounds(rec.coords);
  if (tool === 'step') {
    if (!text) return fail('Visual step mark requires non-empty text.');
    if (bounds) {
      return bounds.x1 === bounds.x2 && bounds.y1 === bounds.y2
        ? okItem({ tool: 'step', point: { x: bounds.x1, y: bounds.y1 }, text })
        : okItem({ tool: 'step', coords: bounds, text });
    }
    const p = normalizeNums(rec.point, ['x', 'y']);
    return p
      ? okItem({ tool: 'step', point: { x: p[0] ?? 0, y: p[1] ?? 0 }, text })
      : fail('Visual step mark requires "point" or "coords".');
  }
  if (!bounds) return fail(`Visual tool "${tool}" requires "coords".`);
  if (tool === 'arrow') {
    return bounds.x1 === bounds.x2 && bounds.y1 === bounds.y2
      ? fail('Arrow coords must have non-zero length.')
      : okItem({ tool: 'arrow', coords: bounds, text });
  }
  const box: CaptureBounds = {
    x1: Math.min(bounds.x1, bounds.x2),
    y1: Math.min(bounds.y1, bounds.y2),
    x2: Math.max(bounds.x1, bounds.x2),
    y2: Math.max(bounds.y1, bounds.y2),
  };
  return box.x1 === box.x2 || box.y1 === box.y2
    ? fail(`Visual "${tool}" coords must have non-zero width and height.`)
    : okItem({ tool, coords: box, text });
}

function normalizeItem(
  raw: unknown,
  action: CaptureAnswerAction,
  byId: ReadonlyMap<string, CaptureParagraph>,
  seenReplace: Set<string>,
): ItemResult {
  if (!raw || typeof raw !== 'object') return fail('Each item must be an object.');
  const rec = raw as Record<string, unknown>;
  const tool =
    typeof rec.tool === 'string' && VALID_TOOLS.has(rec.tool)
      ? (rec.tool as CaptureMarkTool)
      : null;
  if (!tool) return fail('Invalid mark tool.');
  const paragraph = typeof rec.paragraph === 'string' ? rec.paragraph.trim() : '';
  const text = typeof rec.text === 'string' ? rec.text.trim() : '';
  if (action !== 'annotate') {
    const expected = action === 'replaceSelection' ? 'replace' : 'step';
    if (tool !== expected) return fail(`${action} only allows tool "${expected}".`);
    if (!paragraph || !byId.has(paragraph))
      return fail(`Unknown or missing paragraph id "${paragraph}".`);
    if (action === 'replaceSelection') {
      if (seenReplace.has(paragraph))
        return fail(`Duplicate replacement for paragraph "${paragraph}".`);
      seenReplace.add(paragraph);
    }
    if (!text) return fail(`Empty text for paragraph "${paragraph}".`);
    return okItem({ tool: expected, paragraph, text });
  }
  if (!paragraph) return normalizeVisualItem(tool, rec, text);
  const source = byId.get(paragraph);
  if (!source) return fail(`Unknown paragraph id "${paragraph}".`);
  if (tool === 'step')
    return text
      ? okItem({ tool: 'step', paragraph, text })
      : fail(`Step mark on "${paragraph}" requires text.`);
  if (tool !== 'highlight' && tool !== 'mosaic')
    return fail(
      `Tool "${tool}" cannot target a paragraph; use "highlight", "step", or "mosaic", or omit "paragraph".`,
    );
  const phrase = typeof rec.phrase === 'string' ? located(source.text, rec.phrase) : undefined;
  return okItem(
    phrase === undefined ? { tool, paragraph, text } : { tool, paragraph, phrase, text },
  );
}

function overlapRatio(a: CaptureBounds, b: CaptureBounds): number {
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  if (areaA <= 0 || areaB <= 0) return 0;
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return (w * h) / Math.min(areaA, areaB);
}

/** Drops note-less visual `box`/`ellipse` marks that overlap (`>= 0.6`) an already-marked OCR paragraph. */
function suppressDuplicateVisualBoxes(
  items: readonly CaptureAnswerItem[],
  byId: ReadonlyMap<string, CaptureParagraph>,
): CaptureAnswerItem[] {
  const marked: CaptureBounds[] = [];
  for (const item of items) {
    const b = item.paragraph ? byId.get(item.paragraph)?.bounds : undefined;
    if (b && b.x1 < b.x2 && b.y1 < b.y2) marked.push(b);
  }
  if (!marked.length) return [...items];
  return items.filter((item) => {
    if (item.paragraph || !item.coords || item.text.trim() !== '') return true;
    if (item.tool !== 'box' && item.tool !== 'ellipse') return true;
    const coords = item.coords;
    return !marked.some((b) => overlapRatio(coords, b) >= 0.6);
  });
}

function normalizeBatch(
  rawItems: readonly unknown[],
  action: CaptureAnswerAction,
  paragraphs: readonly CaptureParagraph[],
  strict: boolean,
): { ok: true; items: CaptureAnswerItem[] } | { ok: false; error: string } {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const seenReplace = new Set<string>();
  const normalized: CaptureAnswerItem[] = [];
  for (const raw of rawItems) {
    const res = normalizeItem(raw, action, byId, seenReplace);
    if (res.ok) normalized.push(res.item);
    else if (strict) return res;
  }
  return { ok: true, items: suppressDuplicateVisualBoxes(normalized, byId) };
}

/** Validates and normalizes `mark_screenshot` arguments for `action` against known `paragraphs`. */
export function validateCaptureToolCall(
  params: MarkScreenshotParams,
  options: { action: CaptureAnswerAction; paragraphs?: readonly CaptureParagraph[] },
): { ok: true; value: CaptureAnswer } | { ok: false; error: string } {
  const rawItems = Array.isArray(params?.items) ? params.items : [];
  if (!rawItems.length) {
    return {
      ok: false,
      error:
        options.action === 'annotate'
          ? 'items must not be empty. If no canvas marks are needed, do not call mark_screenshot and reply in plain text instead.'
          : 'items must not be empty.',
    };
  }
  const res = normalizeBatch(rawItems, options.action, options.paragraphs ?? [], true);
  if (!res.ok) return res;
  if (!res.items.length)
    return fail(
      'All visual box/ellipse marks duplicated already-marked OCR paragraphs without a note.',
    );
  return {
    ok: true,
    value: {
      lead: options.action === 'replaceSelection' ? '' : (params.lead ?? '').trim(),
      items: res.items,
    },
  };
}

/** Forgivingly extracts streaming or settled `mark_screenshot` arguments into a `CaptureAnswer`. */
export function extractCaptureProgress(
  args: unknown,
  options: {
    action: CaptureAnswerAction;
    paragraphs: readonly CaptureParagraph[];
    settled: boolean;
    assistantLead?: string;
  },
): CaptureAnswer {
  const rec = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const rawLead = typeof rec.lead === 'string' ? rec.lead : '';
  const lead =
    options.action === 'replaceSelection'
      ? ''
      : rawLead.trim() || options.assistantLead?.trim() || '';
  const rawItems = Array.isArray(rec.items) ? rec.items : [];
  const ready = options.settled ? rawItems : rawItems.slice(0, -1);
  const res = normalizeBatch(ready, options.action, options.paragraphs, false);
  return { lead, items: res.ok ? res.items : [] };
}

/** Serializes a `CaptureAnswer` to JSON, or `""` when empty. */
export function serializeCaptureAnswer(answer: CaptureAnswer): string {
  return !answer.lead.trim() && !answer.items.length
    ? ''
    : JSON.stringify({ lead: answer.lead, items: answer.items });
}

/** Parses serialized `CaptureAnswer` JSON or plain-text `annotate` Q&A prose. */
export function parseCaptureAnswer(
  text: string,
  options: { action: CaptureAnswerAction; paragraphs: readonly CaptureParagraph[]; final: boolean },
): CaptureAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { lead: '', items: [] };
  if (trimmed.startsWith('{')) {
    try {
      const p = JSON.parse(trimmed) as { lead?: unknown; items?: unknown } | null;
      if (p && typeof p === 'object' && typeof p.lead === 'string' && Array.isArray(p.items))
        return extractCaptureProgress(
          { lead: p.lead, items: p.items },
          { action: options.action, paragraphs: options.paragraphs, settled: true },
        );
    } catch {
      // Fall through to plain-text handling below.
    }
  }
  return options.action === 'annotate' ? { lead: trimmed, items: [] } : { lead: '', items: [] };
}

/** Merges ordered `mark_screenshot` answers from parallel calls (or retry self-corrections) in one run. */
export function mergeCaptureAnswers(
  answers: readonly CaptureAnswer[],
  options: {
    action: CaptureAnswerAction;
    paragraphs: readonly CaptureParagraph[];
    assistantLead?: string;
  },
): CaptureAnswer {
  let lead = '';
  if (options.action !== 'replaceSelection') {
    lead =
      answers.map((a) => a.lead.trim()).find((s) => s.length > 0) ??
      options.assistantLead?.trim() ??
      '';
  }
  const byId = new Map(options.paragraphs.map((p) => [p.id, p]));
  if (options.action === 'replaceSelection') {
    const byParagraph = new Map<string, CaptureAnswerItem>();
    for (const answer of answers) {
      for (const item of answer.items) {
        if (item.paragraph) byParagraph.set(item.paragraph, item);
      }
    }
    return { lead: '', items: [...byParagraph.values()] };
  }
  const seen = new Set<string>();
  const merged: CaptureAnswerItem[] = [];
  for (const answer of answers) {
    for (const item of answer.items) {
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return { lead, items: suppressDuplicateVisualBoxes(merged, byId) };
}
