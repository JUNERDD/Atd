import { useMemo, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@atd/ui/lib/utils';
import type { JsonRenderNode } from '../_types/node';
import { DEFAULT_EXPANDED_DEPTH, MAX_JSON_TREE_CHARS } from '../_constants/limits';
import { safeParseJson } from '../_helpers/parse-json';
import { Node } from './node';
import { Fallback } from './fallback';
import { DetailBox } from '../../detail-box';

export type JsonTreeRenderNode = (node: JsonRenderNode) => ReactNode;

export interface RootProps extends ComponentProps<'div'> {
  text: string;
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

export function Root({
  text,
  defaultExpandedDepth = DEFAULT_EXPANDED_DEPTH,
  maxChars = MAX_JSON_TREE_CHARS,
  renderNode,
  fallback,
  bare = false,
  className,
  ref,
  ...rest
}: RootProps) {
  const parsed = useMemo(() => safeParseJson(text), [text]);

  if (text.trim() === '' || text.length > maxChars || !parsed.ok) {
    return fallback ?? <Fallback text={text} bare={bare} />;
  }

  const tree = (
    <Node
      nodeKey={null}
      value={parsed.value}
      depth={0}
      defaultExpandedDepth={defaultExpandedDepth}
      renderNode={renderNode}
    />
  );
  return (
    <div {...rest} ref={ref} data-slot="json-tree" className={cn('relative', className)}>
      {bare ? (
        tree
      ) : (
        <DetailBox variant="output" copyText={text}>
          {tree}
        </DetailBox>
      )}
    </div>
  );
}
