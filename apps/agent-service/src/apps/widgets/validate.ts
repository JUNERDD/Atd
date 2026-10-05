import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Compile } from 'typebox/compile';
import {
  WIDGET_IMAGE_MAX_BYTES,
  WIDGET_MAX_DEPTH,
  WIDGET_SNAPSHOT_MAX_BYTES,
  WidgetTimelineSchema,
  type WidgetNode,
  type WidgetSnapshot,
} from '@atd/agent-contracts';

const TimelineValidator = Compile(WidgetTimelineSchema);

/** The deepest nesting of a tree (a leaf is 1). */
function depth(node: WidgetNode): number {
  if (node.type === 'link') return 1 + depth(node.child);
  if (node.type === 'vstack' || node.type === 'hstack' || node.type === 'zstack')
    return 1 + Math.max(0, ...node.children.map(depth));
  return 1;
}

function images(node: WidgetNode): string[] {
  if (node.type === 'image') return [node.src];
  if (node.type === 'link') return images(node.child);
  if (node.type === 'vstack' || node.type === 'hstack' || node.type === 'zstack')
    return node.children.flatMap(images);
  return [];
}

/**
 * Checks what a backend's widget render returned and makes it a snapshot: the timeline schema,
 * entries in ascending date, a tree at most `WIDGET_MAX_DEPTH` deep, images that exist in the
 * version's web root as PNG/JPEG within `WIDGET_IMAGE_MAX_BYTES`, and the serialized snapshot
 * within `WIDGET_SNAPSHOT_MAX_BYTES`. Throws with the reason when any check fails.
 */
export async function widgetSnapshot(value: unknown, webRoot: string): Promise<WidgetSnapshot> {
  if (!TimelineValidator.Check(value)) {
    const first = TimelineValidator.Errors(value)[0];
    const where = first ? ` at ${first.instancePath || '/'}: ${first.message}` : '';
    throw new Error(`The widget timeline does not match the widget schema${where}.`);
  }
  const dates = value.entries.map((entry) => Date.parse(entry.date));
  if (
    dates.some((date, index) => Number.isNaN(date) || (index > 0 && date < (dates[index - 1] ?? 0)))
  )
    throw new Error('Timeline entries must have valid dates in ascending order.');
  for (const entry of value.entries) {
    if (depth(entry.view) > WIDGET_MAX_DEPTH)
      throw new Error(`A widget view is nested deeper than ${WIDGET_MAX_DEPTH} levels.`);
    for (const src of images(entry.view)) {
      const file = path.resolve(webRoot, src);
      const info = file.startsWith(webRoot + path.sep) ? await stat(file).catch(() => null) : null;
      if (!info?.isFile())
        throw new Error(`The widget image ${src} is not in the app's web files.`);
      if (info.size > WIDGET_IMAGE_MAX_BYTES)
        throw new Error(`The widget image ${src} is larger than 256 KiB.`);
    }
  }
  const snapshot: WidgetSnapshot = { generatedAt: new Date().toISOString(), timeline: value };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > WIDGET_SNAPSHOT_MAX_BYTES)
    throw new Error('The widget snapshot is larger than 64 KiB.');
  return snapshot;
}
