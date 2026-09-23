import type {
  DefaultResourceLoader,
  InlineExtension,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

/**
 * Resource loader assembly. Uses Pi's DefaultResourceLoader with factories,
 * diagnostics and conflict handling preserved; the service only constrains
 * the inputs: projectTrusted:false settings, noContextFiles, explicit
 * prompts, and no skills. No loader or parser rewrite.
 */
export interface SkillLoaderInput {
  /** Service profile cwd for resource loading (never the business output dir). */
  loaderCwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  systemPrompt: string;
  appendSystemPrompt: string[];
  extensionFactories: InlineExtension[];
}

/**
 * Builds the loader options for one session. Pi loads no skills and no prompt
 * templates (`noSkills` and `noPromptTemplates` with no extra paths), so its
 * system prompt lists no skills and `/skill:` text, prompted or queued, stays
 * plain text. A run's skills reach the model as a hidden message instead
 * (skills/session-skills.ts). `noContextFiles:true` plus explicit prompts
 * closes the remaining discovery surface.
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
    additionalSkillPaths: [],
    extensionFactories: input.extensionFactories,
  };
}
