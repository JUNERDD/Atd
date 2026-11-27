import type { ContentDiagReporter } from './diag.ts';

/**
 * Copies `text` for the person's click. The async Clipboard API needs a secure context and a
 * focused page; elsewhere (plain-http pages) a selected textarea inside the extension's own shadow
 * root and `execCommand('copy')` still work under the click's user activation.
 */
export async function copyText(
  text: string,
  scratch: HTMLElement,
  onDiag?: ContentDiagReporter,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (clipboardError) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.setProperty('position', 'fixed');
    area.style.setProperty('opacity', '0');
    scratch.append(area);
    try {
      area.select();
      const copied = document.execCommand('copy');
      if (!copied) onDiag?.('warn', 'clipboard', 'copy_failed', clipboardError);
      return copied;
    } catch (fallbackError) {
      onDiag?.('warn', 'clipboard', 'copy_failed', fallbackError);
      return false;
    } finally {
      area.remove();
    }
  }
}
