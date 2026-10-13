import { Type, type Static } from 'typebox';
import type { StreamOptions } from '@earendil-works/pi-ai';
import { parse } from '@atd/agent-contracts';

const ToolSchema = Type.Object(
  { type: Type.String(), name: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
const PayloadSchema = Type.Object(
  { tools: Type.Optional(Type.Array(ToolSchema)) },
  { additionalProperties: true },
);

function isCallable(tool: Static<typeof ToolSchema>): boolean {
  return tool.type === 'function' || tool.type === 'custom';
}

/** Compose the public hook before applying SIWC's wire format to its final payload. */
export function chatgptPayload(
  onPayload: StreamOptions['onPayload'],
): NonNullable<StreamOptions['onPayload']> {
  return async (payload, model) => {
    const replacement = await onPayload?.(payload, model);
    const body = parse(PayloadSchema, replacement === undefined ? payload : replacement);
    const tools = body.tools ?? [];
    const callable = tools.filter(isCallable);
    if (callable.length === 0) return body;

    // Pi 1.1.0 leaves initial/current tools at the top level. SIWC accepts those only in
    // namespaces; its transcript-anchored additional_tools and call namespaces stay intact.
    const occupied = new Set(
      tools.filter((tool) => tool.type === 'namespace').map((tool) => tool.name),
    );
    let namespace = 'functions';
    for (let suffix = 2; occupied.has(namespace); suffix++) namespace = `functions_${suffix}`;

    return {
      ...body,
      tools: [
        ...tools.filter((tool) => !isCallable(tool)),
        {
          type: 'namespace',
          name: namespace,
          description: 'Functions available to the assistant.',
          tools: callable,
        },
      ],
    };
  };
}
