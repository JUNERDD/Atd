import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atd/ui/components/collapsible';
import { cn } from '@atd/ui/lib/utils';
import { agentApi } from '../../../use-agent';
import { showErrorToast } from '../../../../../components/toast-store';
import { MAX_JSON_CHILDREN_PER_NODE } from '../_constants/limits';
import type { JsonNodeType, JsonRenderNode } from '../_types/node';
import { previewFor } from '../_helpers/format-preview';

interface NodeProps {
  path: string;
  nodeKey: string | number | null;
  value: unknown;
  depth: number;
  initialExpandedPaths: ReadonlySet<string>;
  childPath: (parentPath: string, key: string | number) => string;
  formatShowMore: (next: number, remaining: number) => string;
  renderNode?: ((node: JsonRenderNode) => ReactNode) | undefined;
}

function nodeTypeOf(value: unknown): JsonNodeType {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'primitive';
}

function formatLeaf(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function formatKey(nodeKey: string | number): string {
  return typeof nodeKey === 'string' ? JSON.stringify(nodeKey) : String(nodeKey);
}

export function Node({
  path,
  nodeKey,
  value,
  depth,
  initialExpandedPaths,
  childPath,
  formatShowMore,
  renderNode,
}: NodeProps) {
  const [expanded, setExpanded] = useState(() => initialExpandedPaths.has(path));
  const [visibleCount, setVisibleCount] = useState(MAX_JSON_CHILDREN_PER_NODE);

  const type = nodeTypeOf(value);
  const toggle = () => setExpanded((previous) => !previous);

  // Copy stays available as data for custom `renderNode` renderers; the default tree renders no
  // per-node copy button — only the root keeps one.
  async function copyValue() {
    try {
      await agentApi().copy(JSON.stringify(value, null, 2));
    } catch (error) {
      showErrorToast(error);
    }
  }
  const copy = () => {
    void copyValue();
  };

  if (renderNode) {
    const custom = renderNode({ key: nodeKey, value, depth, type, expanded, toggle, copy });
    return <>{custom}</>;
  }

  if (type === 'primitive') {
    return (
      <div className="flex min-w-0 items-baseline gap-1.5 py-px">
        {nodeKey === null ? null : (
          <span className="shrink-0 text-muted-foreground">{formatKey(nodeKey)}:</span>
        )}
        <span className={cn(typeof value === 'string' && 'wrap-anywhere whitespace-pre-wrap')}>
          {formatLeaf(value)}
        </span>
      </div>
    );
  }

  // Only materialize child entries while expanded so collapsed subtrees do zero eager mapping.
  const entries: Array<readonly [string | number, unknown]> = expanded
    ? Array.isArray(value)
      ? value.map((item: unknown, index: number) => [index, item] as const)
      : Object.entries(value as Record<string, unknown>)
    : [];
  const visibleEntries = entries.length > visibleCount ? entries.slice(0, visibleCount) : entries;
  const remaining = entries.length - visibleEntries.length;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="min-w-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-label={nodeKey === null ? previewFor(value) : String(nodeKey)}
          className="flex w-full min-w-0 items-center gap-1 py-px"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
              expanded && 'rotate-90',
            )}
          />
          {nodeKey === null ? null : (
            <span className="shrink-0 truncate text-muted-foreground">{formatKey(nodeKey)}:</span>
          )}
          {expanded ? null : (
            <span className="truncate text-muted-foreground">{previewFor(value)}</span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* The bare grid child clips the inset with the shared unfold; Radix keeps descendants
            mounted only while open or finishing their close animation. */}
        <div>
          <div className="pl-4">
            {visibleEntries.map(([key, item]) => (
              <Node
                key={key}
                path={childPath(path, key)}
                nodeKey={key}
                value={item}
                depth={depth + 1}
                initialExpandedPaths={initialExpandedPaths}
                childPath={childPath}
                formatShowMore={formatShowMore}
                renderNode={renderNode}
              />
            ))}
            {remaining > 0 ? (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + MAX_JSON_CHILDREN_PER_NODE)}
                className="py-px text-xs text-muted-foreground hover:text-foreground"
              >
                {formatShowMore(Math.min(remaining, MAX_JSON_CHILDREN_PER_NODE), remaining)}
              </button>
            ) : null}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
