import type { Screenshot } from '../../client/agent/screenshot-input';
import type { CaptureMode } from '../../client/capture-bridge';
import i18n from '../../i18n';
import { startLightAsk } from './light-capture';

let capturing = false;

/**
 * The full capture workflow shared by the composer, global shortcuts and mini panel. Commands
 * launch through the native host and questions run on the island; only a confirmed screenshot
 * returns to the caller's draft. The caller owns its attachment limit, insertion and focus.
 * A second entry gesture during capture does nothing, rather than opening another overlay.
 */
export async function captureScreen(mode: CaptureMode): Promise<Screenshot | null> {
  if (capturing) return null;
  const desktop = window.desktop;
  if (!desktop?.capture) throw new Error(i18n.t('errors.openDesktopApp', { ns: 'panel' }));
  capturing = true;
  try {
    const captured = await desktop.capture.capture(mode);
    switch (captured.kind) {
      case 'attach':
        return captured.shot;
      case 'ask': {
        const light = desktop.agent?.light;
        if (!light) throw new Error(i18n.t('errors.openDesktopApp', { ns: 'panel' }));
        await startLightAsk(captured.question, captured.shot, light);
        return null;
      }
      case 'launched':
      case 'none':
        return null;
    }
  } finally {
    capturing = false;
  }
}
