export type JsonNodeType = 'object' | 'array' | 'primitive';

export interface JsonRenderNode {
  key: string | number | null;
  value: unknown;
  depth: number;
  type: JsonNodeType;
  expanded: boolean;
  toggle: () => void;
  copy: () => void;
}
