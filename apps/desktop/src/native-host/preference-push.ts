import type { AppAppearance, PanelBackground } from '@atd/agent-contracts';
import type { SettingsSnapshot } from '../client/settings-contract';
import type { NativeBridge } from '../native-bridge/client';
import { nativePanelBackground } from '../theme/panel-background/derive';
import { onSystemAppearance, systemAppearance } from '../theme/panel-background/system-appearance';

/**
 * The panel's pushes of the app-wide preferences the shell applies itself (`preference-posts.ts`
 * and `typing.set`): each is posted on the first loaded snapshot and again only when it changes.
 * The panel background goes out resolved (`nativePanelBackground`), so it also changes with the
 * system accent color its `accent` tint follows; a new accent pushes it again without a settings
 * change, though never before the first snapshot.
 */
export function preferencePusher(native: NativeBridge): (next: SettingsSnapshot) => void {
  let pushedLanguage: string | null = null;
  let pushedAppearance: AppAppearance | null | undefined;
  let pushedGlow: boolean | undefined;
  let pushedResultMarkdown: boolean | undefined;
  let pushedTyping: string | null = null;
  let background: PanelBackground | null = null;
  let pushedBackground: string | null = null;
  const pushBackground = () => {
    if (!background) return;
    const resolved = nativePanelBackground(background, systemAppearance().accentColor);
    if (JSON.stringify(resolved) === pushedBackground) return;
    pushedBackground = JSON.stringify(resolved);
    native.post('panelBackground.set', resolved);
  };
  onSystemAppearance(pushBackground);
  return (next) => {
    // The shell prepares a browser for the typing animation when a command is summoned, before
    // any write tells it the settings.
    const typing = { typing: next.commandTyping, animation: next.commandTypingAnimation };
    if (JSON.stringify(typing) !== pushedTyping) {
      pushedTyping = JSON.stringify(typing);
      native.post('typing.set', typing);
    }
    if (next.appearance !== pushedAppearance) {
      pushedAppearance = next.appearance;
      native.post('appearance.set', { appearance: next.appearance });
    }
    if (next.glowEffects !== pushedGlow) {
      pushedGlow = next.glowEffects;
      native.post('glowEffects.set', { enabled: next.glowEffects });
    }
    if (next.resultMarkdown !== pushedResultMarkdown) {
      pushedResultMarkdown = next.resultMarkdown;
      native.post('resultMarkdown.set', { enabled: next.resultMarkdown });
    }
    background = next.panelBackground;
    pushBackground();
    if (next.language === pushedLanguage) return;
    pushedLanguage = next.language;
    native.post('language.set', { language: next.language });
  };
}
