import type { AppAppearance } from '@atd/agent-contracts';
import type { SettingsSnapshot } from '../client/settings-contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * The panel's pushes of the app-wide preferences the shell applies itself (`preference-posts.ts`
 * and `typing.set`): each is posted on the first loaded snapshot and again only when it changes.
 */
export function preferencePusher(native: NativeBridge): (next: SettingsSnapshot) => void {
  let pushedLanguage: string | null = null;
  let pushedAppearance: AppAppearance | null | undefined;
  let pushedGlow: boolean | undefined;
  let pushedTyping: string | null = null;
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
    if (next.language === pushedLanguage) return;
    pushedLanguage = next.language;
    native.post('language.set', { language: next.language });
  };
}
