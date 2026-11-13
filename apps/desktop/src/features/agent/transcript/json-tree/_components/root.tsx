import { useMemo, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@atd/ui/lib/utils';
import type { JsonRenderNode } from '../_types/node';
import {
  DEFAULT_EXPANDED_DEPTH,
  MAX_JSON_CHILDREN_PER_NODE,
  MAX_JSON_INITIAL_NODES,
  MAX_JSON_TREE_CHARS,
} from '../_constants/limits';
import { safeParseJson } from '../_helpers/parse-json';
import { Node } from './node';
import { Fallback } from './fallback';
import { DetailBox } from '../../detail-box';

export type JsonTreeRenderNode = (node: JsonRenderNode) => ReactNode;

export interface RootProps extends ComponentProps<'div'> {
  text?: string;
  value?: unknown;
  defaultExpandedDepth?: number;
  maxChars?: number;
  renderNode?: JsonTreeRenderNode;
  fallback?: ReactNode;
  /**
   * Renders the tree (and the default verbatim fallback) without its own box and copy action, for
   * a host that already frames the content, such as a tool card.
   */
  bare?: boolean;
}

function isContainer(value: unknown): value is unknown[] | Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function jsonChildPath(parentPath: string, key: string | number): string {
  return `${parentPath}\0${typeof key === 'number' ? 'i' : 'k'}${key}`;
}

/**
 * BFS over the JSON tree to determine which container paths start expanded while capping the
 * total initially mounted React node count to `maxNodes`.
 */
function collectInitialExpandedPaths(
  rootValue: unknown,
  maxDepth: number,
  maxNodes: number,
  maxChildrenPerNode: number,
): ReadonlySet<string> {
  const expanded = new Set<string>();
  if (maxDepth <= 0 || !isContainer(rootValue)) return expanded;

  const queue: Array<{ path: string; value: unknown; depth: number }> = [
    { path: '$', value: rootValue, depth: 0 },
  ];
  let budget = Math.max(0, maxNodes - 1);

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    if (current.depth >= maxDepth || !isContainer(current.value)) continue;

    let entries: Array<readonly [string | number, unknown]>;
    if (Array.isArray(current.value)) {
      const len = Math.min(current.value.length, maxChildrenPerNode);
      entries = [];
      for (let i = 0; i < len; i += 1) entries.push([i, current.value[i]] as const);
    } else {
      const keys = Object.keys(current.value);
      const len = Math.min(keys.length, maxChildrenPerNode);
      entries = [];
      for (let i = 0; i < len; i += 1) {
        const key = keys[i]!;
        entries.push([key, current.value[key]] as const);
      }
    }

    if (entries.length > budget) continue;
    expanded.add(current.path);
    budget -= entries.length;
    for (const [key, child] of entries) {
      if (isContainer(child)) {
        queue.push({
          path: jsonChildPath(current.path, key),
          value: child,
          depth: current.depth + 1,
        });
      }
    }
  }

  return expanded;
}

export function Root({
  text,
  value,
  defaultExpandedDepth = DEFAULT_EXPANDED_DEPTH,
  maxChars = MAX_JSON_TREE_CHARS,
  renderNode,
  fallback,
  bare = false,
  className,
  ref,
  ...rest
}: RootProps) {
  const { t } = useTranslation('tasks');
  const hasDirectValue = value !== undefined;
  const oversizeOrBlank =
    !hasDirectValue && (!text || text.trim() === '' || text.length > maxChars);
  const parsed = useMemo(
    () => (hasDirectValue || oversizeOrBlank || !text ? null : safeParseJson(text)),
    [hasDirectValue, oversizeOrBlank, text],
  );

  const rootValue = hasDirectValue ? value : parsed?.ok ? parsed.value : undefined;
  const invalidText = !hasDirectValue && (oversizeOrBlank || !parsed?.ok);

  const initialExpandedPaths = useMemo(
    () =>
      invalidText
        ? new Set<string>()
        : collectInitialExpandedPaths(
            rootValue,
            defaultExpandedDepth,
            MAX_JSON_INITIAL_NODES,
            MAX_JSON_CHILDREN_PER_NODE,
          ),
    [invalidText, rootValue, defaultExpandedDepth],
  );

  const copyText = useMemo(
    () => (bare ? '' : (text ?? (hasDirectValue ? JSON.stringify(value, null, 2) : ''))),
    [bare, text, hasDirectValue, value],
  );

  if (invalidText) {
    return fallback ?? <Fallback text={text ?? ''} bare={bare} />;
  }

  const formatShowMore = (next: number, remaining: number) =>
    `+${next} (${t('toolCount.item', { count: remaining })})`;

  const tree = (
    <Node
      path="$"
      nodeKey={null}
      value={rootValue}
      depth={0}
      initialExpandedPaths={initialExpandedPaths}
      childPath={jsonChildPath}
      formatShowMore={formatShowMore}
      renderNode={renderNode}
    />
  );
  return (
    <div {...rest} ref={ref} data-slot="json-tree" className={cn('relative', className)}>
      {bare ? (
        tree
      ) : (
        <DetailBox variant="output" copyText={copyText}>
          {tree}
        </DetailBox>
      )}
    </div>
  );
}
