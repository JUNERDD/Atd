import {
  DefaultResourceLoader,
  type InlineExtension,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { mapPiDiagnostics } from './diagnostics.js';

/**
 * Skill loader assembly. Uses Pi's DefaultResourceLoader with factories,
 * diagnostics and conflict handling preserved; the service only constrains
 * the inputs: projectTrusted:false settings, noContextFiles, explicit
 * prompts, and frozen absolute skill entries. No loader or parser rewrite.
 */
export interface SkillLoaderInput {
  /** Service profile cwd for resource loading (never the business output dir). */
  loaderCwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  /** Frozen absolute skill entries for this run; empty means no skills. */
  skillEntries: string[];
  systemPrompt: string;
  appendSystemPrompt: string[];
  extensionFactories: InlineExtension[];
}

export interface SkillLoaderResult {
  loader: DefaultResourceLoader;
  skills: { name: string; description: string; disableModelInvocation: boolean }[];
  diagnostics: ReturnType<typeof mapPiDiagnostics>;
}

/**
 * Builds the loader for one run. `noSkills:true` plus explicit
 * `additionalSkillPaths` means Pi loads exactly the frozen entries with
 * `includeDefaults:false`; user/global and project skill dirs are never
 * scanned. `noContextFiles:true` plus explicit prompts closes the remaining
 * discovery surface.
 */
export function buildSkillLoaderOptions(
  input: SkillLoaderInput,
): ConstructorParameters<typeof DefaultResourceLoader>[0] {
  return {
    cwd: input.loaderCwd,
    agentDir: input.agentDir,
    settingsManager: input.settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: input.systemPrompt,
    appendSystemPrompt: input.appendSystemPrompt,
    additionalSkillPaths: [...input.skillEntries],
    extensionFactories: input.extensionFactories,
  };
}

/** Creates, reloads and projects the Pi skill set for proof/diagnostics. */
export async function createSkillLoader(input: SkillLoaderInput): Promise<SkillLoaderResult> {
  const loader = new DefaultResourceLoader(buildSkillLoaderOptions(input));
  await loader.reload();
  const current = loader.getSkills();
  return {
    loader,
    skills: current.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
    })),
    diagnostics: mapPiDiagnostics(current.diagnostics),
  };
}

/**
 * Run-available discovery: only skills pinned in the frozen snapshot are
 * presented. Pi's `disable-model-invocation` keeps its upstream meaning
 * (excluded from the prompt, explicit `/skill:name` still allowed).
 */
export function runAvailableSkills(snapshot: {
  skills: { name: string; description: string; disableModelInvocation: boolean }[];
}): { name: string; description: string; disableModelInvocation: boolean }[] {
  return snapshot.skills.map((skill) => ({ ...skill }));
}
