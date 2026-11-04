import { useLayoutEffect } from 'react';
import { DEFAULT_PANEL_BACKGROUND, type PanelBackground } from '@atd/agent-contracts';
import { panelSurface, type Theme } from './derive';
import { CODE_LINE_NUMBER } from './measured';
import { useSystemAppearance } from './system-appearance';

const THEMES: readonly Theme[] = ['dark', 'light'];

/**
 * The page's panel surface for both appearances, as the root element's custom properties
 * `--ata-panel-<part>-<theme>`. The theme scopes in `@atd/ui`'s stylesheet read them into the
 * panel fill, its Reduce Transparency fill, the secondary text, the raised wash, and the code
 * well and its line numbers, each falling back to the measured recipe while one is unset.
 */
export function panelSurfaceProperties(
  background: PanelBackground,
  accentColor: string,
): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const theme of THEMES) {
    const surface = panelSurface(theme, background, accentColor);
    properties[`--ata-panel-fill-${theme}`] = surface.fill;
    properties[`--ata-panel-fill-opaque-${theme}`] = surface.opaqueFill;
    properties[`--ata-panel-text-secondary-${theme}`] = surface.secondaryText;
    properties[`--ata-panel-raised-${theme}`] = surface.raised;
    properties[`--ata-panel-code-surface-${theme}`] = surface.codeSurface;
    properties[`--ata-panel-code-line-number-${theme}`] = CODE_LINE_NUMBER[theme];
  }
  return properties;
}

/**
 * Applies the panel background setting to this window's page, the service's default until the
 * settings load. Both appearances are set at once, since the scheme can change without the
 * setting, and they are derived again when the setting or the system accent color (which the
 * `accent` tint follows) changes. One call per window, in its root component: the properties are
 * the page's, and the call takes them away when it unmounts.
 */
export function usePanelSurfaces(background: PanelBackground | undefined): void {
  const { accentColor } = useSystemAppearance();
  const setting = background ?? DEFAULT_PANEL_BACKGROUND;
  // Before the paint, so the tree's first frame and every change already show the setting.
  useLayoutEffect(() => {
    const { style } = document.documentElement;
    const properties = Object.entries(panelSurfaceProperties(setting, accentColor));
    for (const [name, value] of properties) style.setProperty(name, value);
    return () => {
      for (const [name] of properties) style.removeProperty(name);
    };
  }, [setting, accentColor]);
}
