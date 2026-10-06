import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  DesktopCapabilitySchema,
  errorMessage,
  type DesktopCapability,
} from '@atd/agent-contracts';
import type { CapabilityRegistry } from './capabilities.js';
import { auditUnattended, UNATTENDED_DESKTOP } from './unattended.js';

/** What the desktop tool needs from the service tool host (tool-proxies.ts). */
export interface DesktopToolHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  capabilities: CapabilityRegistry;
  /** Whether the current run is unattended (unattended.ts); its desktop requests are refused. */
  unattended: () => boolean;
  audit: (entry: Record<string, unknown>) => void;
}

/**
 * Desktop-only abilities as capability requests a connected client serves;
 * the service never touches the file picker, selection or clipboard itself.
 * An unattended run gets an error instead: nobody is at the desktop to answer
 * a dialog, and a clipboard write would change the person's clipboard unseen.
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
      const base = {
        taskId: host.taskId,
        runId: host.runId(),
        tool: `desktop:${params.capability}`,
      };
      if (host.unattended()) {
        auditUnattended(host.audit, { ...base, kind: 'desktop', title: base.tool });
        return {
          content: [{ type: 'text', text: UNATTENDED_DESKTOP }],
          details: {},
          isError: true,
        };
      }
      host.audit({ ...base, decision: 'request' });
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
