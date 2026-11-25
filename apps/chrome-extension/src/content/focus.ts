import { signal } from './lifetime.ts';

/**
 * Whether keyboard focus is inside one of the page's frames: the top document's focused element
 * (looking into open shadow roots, where a frame may sit) is an IFRAME or FRAME, or an EMBED or
 * OBJECT, which hold a nested document or a plugin such as Chrome's PDF viewer. The extension's
 * selection bar cannot see selections in any of them, so the background tells Atd (`focus.state`)
 * and Atd's own selection toolbar does not step aside there.
 */
function focusInFrame(): boolean {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return (
    active instanceof HTMLIFrameElement ||
    active instanceof HTMLFrameElement ||
    active instanceof HTMLEmbedElement ||
    active instanceof HTMLObjectElement
  );
}

export interface FocusReporter {
  /** Sends the current state again (after every `ready`: the background may have restarted). */
  resend(): void;
}

/**
 * Reports `focusInFrame` whenever it changes: focus moving into or out of a frame shows on the top
 * window as blur and focus, on its document as focusin and focusout, and with the tab's visibility.
 * Each change is read once the event has settled (the focused element updates around it).
 */
export function watchFocus(report: (inFrame: boolean) => void): FocusReporter {
  let last: boolean | null = null;
  let timer = 0;
  const check = (): void => {
    const inFrame = focusInFrame();
    if (inFrame === last) return;
    last = inFrame;
    report(inFrame);
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 0);
  };
  addEventListener('blur', later, { signal });
  addEventListener('focus', later, { signal });
  document.addEventListener('focusin', later, { capture: true, signal });
  document.addEventListener('focusout', later, { capture: true, signal });
  document.addEventListener('visibilitychange', later, { signal });
  return {
    resend: () => {
      last = null;
      check();
    },
  };
}
