import { DEFAULT_VIEW_INITIATIVE, type ViewInitiative } from '@atd/agent-contracts';
import { readStoredSettings } from '../settings/store.js';
import type { ServicePaths } from '../storage.js';

/**
 * System prompt section that tells the model how readily to show views. Pi wraps it as
 * `<interactive_views>`, the name the generative-ui skill refers to it by.
 */
export const VIEW_INITIATIVE_SECTION = 'interactive_views';

/**
 * What the model reads at each level of `UserSettings.viewInitiative` (agent-contracts views.ts).
 * The level decides how readily the model acts on a moment a view would serve, never whether text
 * would serve better, and each text says where the user can change it; the generative-ui skill
 * teaches how to build the view.
 */
export const VIEW_INITIATIVE_TEXT: Readonly<Record<ViewInitiative, string>> = {
  proactive:
    "The user set how readily you show interactive views to Proactive. Watch for the moments in a task when the user would decide, check or understand something faster by seeing and handling it than by reading about it: options to compare, several values to set together, results or data with more than a few items or numbers, a plan or a change to review before you act, something to try out, a preview. At such a moment, show a view as part of your answer without waiting to be asked, and load the generative-ui skill before the first one. Within reason: answers that read well as text, such as explanations, short replies, code and anything a sentence or two settles, stay text; one view serves one purpose and is updated rather than shown again; and after the user dismisses a view or says they don't need one, don't show another for that purpose. The user can change this level in Atd's Settings, under General.",
  balanced:
    "The user set how readily you show interactive views to Balanced. Show a view when it clearly serves the user better than text, as the generative-ui skill describes, and answer in text otherwise. The user can change this level in Atd's Settings, under General.",
  onRequest:
    "The user set how readily you show interactive views to On request. Show a view only when the user asks for one, or for something only a view can give them, such as choosing between looks or adjusting a live preview; answer everything else in text. When a view would clearly help, you may offer one in a sentence. The user can change this level in Atd's Settings, under General.",
};

/**
 * The level a full run freezes as it starts (`RunMaterial.viewInitiative`): the stored setting, or
 * the default while no client has written settings yet. Like the computer's vision model
 * (computer/vision-model.ts) it is read from the settings file the live store writes atomically,
 * so a change in Settings applies from the next run and never to one already going.
 */
export async function freezeViewInitiative(
  paths: Pick<ServicePaths, 'root'>,
): Promise<ViewInitiative> {
  const stored = await readStoredSettings(paths.root);
  return stored?.settings.viewInitiative ?? DEFAULT_VIEW_INITIATIVE;
}
