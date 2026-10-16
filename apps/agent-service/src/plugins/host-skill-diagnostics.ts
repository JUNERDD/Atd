import path from 'node:path';
import type { PluginDiagnostic } from '@atd/plugin-kit';
import { isBuiltinSkill } from '../builtins/manifest.js';
import { atdSkillsDir } from '../service-fs.js';
import type { SkillDiagnostic } from '../skills/diagnostics.js';
import { userAgentsSkillsDir } from '../skills/user-agents.js';

/** Keep loader failures with the host catalog that owns the file, even when no skill loaded. */
export function hostSkillDiagnostics(
  personal: readonly SkillDiagnostic[],
  shared: readonly SkillDiagnostic[],
): ReadonlyMap<string, PluginDiagnostic[]> {
  const result = new Map<string, PluginDiagnostic[]>();
  const add = (id: string, diagnostic: SkillDiagnostic, root: string) => {
    const source = diagnostic.path ?? diagnostic.loserPath;
    const relative = source ? path.relative(root, source).split(path.sep).join('/') : undefined;
    const item: PluginDiagnostic = {
      level: diagnostic.type === 'error' ? 'error' : 'warning',
      code: diagnostic.code === 'same_name' ? 'duplicate' : 'invalid-component',
      message: diagnostic.message.slice(0, 2000),
      ...(relative ? { path: relative.slice(0, 1024) } : {}),
      ...(diagnostic.skill ? { component: { kind: 'skill', name: diagnostic.skill } } : {}),
    };
    result.set(id, [...(result.get(id) ?? []), item]);
  };
  const root = atdSkillsDir();
  for (const diagnostic of personal) {
    const name =
      diagnostic.skill ??
      (diagnostic.path ? path.relative(root, diagnostic.path).split(path.sep)[0] : undefined);
    add(name && isBuiltinSkill(name) ? 'builtin:core' : 'user', diagnostic, root);
  }
  for (const diagnostic of shared) add('shared:agents-skills', diagnostic, userAgentsSkillsDir());
  return result;
}
