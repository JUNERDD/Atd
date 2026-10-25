import { createHash } from 'node:crypto';
import { canonicalJson, type ServiceCommandFull } from '@atd/agent-contracts';
import { defaultArguments } from './templates.js';

/**
 * The fingerprint of a saved command as a run would resolve it: its instructions (which name the
 * skills and references the run stages), parameters with their defaults, input rules, tools,
 * model, reasoning level and memory flag, and whose command it is. A computer grant keeps it, so
 * an automation's `revision` is not the only guard: editing the command it runs voids the grant,
 * and a launch that expects a fingerprint refuses a command that changed since the fire froze it
 * (commands/launch.ts `expectedFingerprint`). `revision`, name, placement, output, shortcuts and
 * remembered arguments are left out: they never change what an unattended run does.
 */
export function commandFingerprint(command: ServiceCommandFull): string {
  const content = {
    v: 1,
    id: command.id,
    pluginId: command.pluginId ?? null,
    instructions: command.instructions,
    parameters: command.parameters,
    defaults: defaultArguments(command),
    input: command.input,
    tools: command.tools,
    model: command.model,
    thinkingLevel: command.thinkingLevel,
    memory: command.memory,
  };
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}
