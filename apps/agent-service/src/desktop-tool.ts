import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DesktopCapabilitySchema, errorMessage, type DesktopCapability } from '@ai/agent-contracts';
import type { CapabilityRegistry } from './capabilities.js';

/** What the desktop tool needs from the service tool host (tool-proxies.ts). */
export interface DesktopToolHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  capabilities: CapabilityRegistry;
  audit: (entry: Record<string, unknown>) => void;
}

/**
 * Desktop-only abilities as capability requests a connected client serves;
 * the service never touches the file picker, selection or clipboard itself.
 */
export function registerDesktopTool(pi: ExtensionAPI, host: DesktopToolHost): void {
  pi.registerTool({
    name: 'desktop',
    label: 'Desktop abilities',
    description:
      'Desktop-only abilities served by a connected client (file picker, selection, clipboard).',
    parameters: Type.Object(
      { capability: DesktopCapabilitySchema, input: Type.Optional(Type.Unknown()) },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_id, args, signal) {
      void _id;
      signal?.throwIfAborted();
      const params = args as { capability: DesktopCapability; input?: unknown };
      host.audit({
        taskId: host.taskId,
        runId: host.runId(),
        tool: `desktop:${params.capability}`,
        decision: 'request',
      });
      try {
        const value = await host.capabilities.request(
          {
            capability: params.capability,
            input: params.input ?? null,
            taskId: host.taskId,
            runId: host.runId(),
            executionId: host.executionId(),
          },
          signal ?? undefined,
        );
        return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
      } catch (error) {
        // A failed request is an error result, not a success the model reads as an answer.
        return {
          content: [{ type: 'text', text: `Desktop capability failed: ${errorMessage(error)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
