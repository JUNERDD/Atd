import type { DesktopBridge } from '../electron/contract';

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
