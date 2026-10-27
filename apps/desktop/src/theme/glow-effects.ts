import { useEffect } from 'react';
import { DEFAULT_GLOW_EFFECTS } from '../client/settings-contract';

/**
 * Applies the user's glow effects setting to the page and answers it, the service's default until
 * the settings load. With the effects off the root element carries `data-glow-effects="off"`, which
 * stills the running-text shimmer (`.ai-shimmer` in `@atd/ui`); callers leave their own glows out.
 */
export function useGlowEffects(enabled: boolean | undefined): boolean {
  const glow = enabled ?? DEFAULT_GLOW_EFFECTS;
  useEffect(() => {
    if (glow) delete document.documentElement.dataset.glowEffects;
    else document.documentElement.dataset.glowEffects = 'off';
  }, [glow]);
  return glow;
}
