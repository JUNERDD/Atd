/**
 * Copies `text` for the person's click. The async Clipboard API needs a secure context and a
 * focused page; elsewhere (plain-http pages) a selected textarea inside the extension's own shadow
 * root and `execCommand('copy')` still work under the click's user activation.
 */
export async function copyText(text: string, scratch: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.setProperty('position', 'fixed');
    area.style.setProperty('opacity', '0');
    scratch.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}
