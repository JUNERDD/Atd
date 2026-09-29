import type { DesktopBridge } from './client/contract';

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
