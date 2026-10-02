import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@atd/ui/lib/utils';
import { agentApi } from '../../../use-agent';
import { showErrorToast } from '../../../../../components/toast-store';
import type { JsonNodeType, JsonRenderNode } from '../_types/node';
import { previewFor } from '../_helpers/format-preview';

interface NodeProps {
  nodeKey: string | number | null;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
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

export function Node({ nodeKey, value, depth, defaultExpandedDepth, renderNode }: NodeProps) {
  const [expanded, setExpanded] = useState(() => depth < defaultExpandedDepth);

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

  const entries: Array<readonly [string | number, unknown]> = Array.isArray(value)
    ? value.map((item: unknown, index: number) => [index, item] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={nodeKey === null ? previewFor(value) : String(nodeKey)}
        className="flex w-full min-w-0 items-center gap-1 py-px"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
        />
        {nodeKey === null ? null : (
          <span className="shrink-0 truncate text-muted-foreground">{formatKey(nodeKey)}:</span>
        )}
        {expanded ? null : (
          <span className="truncate text-muted-foreground">{previewFor(value)}</span>
        )}
      </button>
      {expanded && (
        <div className="pl-4">
          {entries.map(([key, item]) => (
            <Node
              key={key}
              nodeKey={key}
              value={item}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              renderNode={renderNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
