import { globalShortcut } from 'electron';
import { effectiveAccelerator } from './accelerators';

export class PanelShortcut {
  private accelerator = '';
  available = false;

  constructor(private readonly toggle: () => void) {}

  private register(accelerator: string): boolean {
    try {
      return globalShortcut.register(accelerator, this.toggle);
    } catch {
      return false;
    }
  }

  initialize(accelerator: string) {
    this.accelerator = accelerator;
    this.available = this.register(accelerator);
  }

  /**
   * Switches to a binding chosen elsewhere (another client). Unlike `replace` it never refuses:
   * an accelerator the OS will not grant leaves the panel shortcut unavailable.
   */
  adopt(accelerator: string) {
    if (
      effectiveAccelerator(accelerator, process.platform) ===
      effectiveAccelerator(this.accelerator, process.platform)
    )
      return;
    if (this.available) globalShortcut.unregister(this.accelerator);
    this.accelerator = accelerator;
    this.available = this.register(accelerator);
  }

  async replace(accelerator: string, persist: () => Promise<void>) {
    if (
      this.available &&
      effectiveAccelerator(accelerator, process.platform) ===
        effectiveAccelerator(this.accelerator, process.platform)
    ) {
      await persist();
      this.accelerator = accelerator;
      return;
    }
    if (!this.register(accelerator)) {
      throw new Error('That global shortcut is unavailable. Choose another combination.');
    }
    // Keep the old registration until the replacement is safely persisted.
    try {
      await persist();
    } catch (error) {
      globalShortcut.unregister(accelerator);
      throw error;
    }
    if (this.available) globalShortcut.unregister(this.accelerator);
    this.accelerator = accelerator;
    this.available = true;
  }
}
