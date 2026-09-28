import { useEffect, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { showErrorToast } from '../../components/toast-store';

/**
 * A hidden page refuses element focus, so a revealed panel lands on the first control of the native
 * window and its tooltip instead. The presented view marks its primary input with
 * data-panel-autofocus; a view without one keeps the header unfocused. The composer editor
 * focuses through its view, which restores its own selection.
 */
export function focusPanelInput() {
  const input = document.querySelector<HTMLElement>('[data-panel-autofocus]');
  if (input) {
    const editor = EditorView.findFromDOM(input);
    if (editor) editor.focus();
    else input.focus();
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('.panel-header')) active.blur();
}

/** Reveals the panel window through the desktop bridge; the renderer owns when a panel appears. */
export async function showPanel() {
  const restore = () => {
    document.removeEventListener('visibilitychange', restore);
    focusPanelInput();
  };
  if (document.visibilityState === 'hidden') document.addEventListener('visibilitychange', restore);
  try {
    await window.desktop?.show();
    focusPanelInput();
  } catch (error) {
    document.removeEventListener('visibilitychange', restore);
    showErrorToast(error);
  }
}

/**
 * The main process reveals the panel without telling the renderer (global shortcut, menu bar item,
 * Dock, second launch), so every reveal restores focus here once the page becomes visible. Focus
 * the user left inside the panel content, such as a question answer, survives the reveal.
 */
function restoreRevealedFocus() {
  if (document.visibilityState !== 'visible') return;
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('.panel-header')) return;
  focusPanelInput();
}

export function usePanelWindow() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!window.desktop) return;
    document.addEventListener('visibilitychange', restoreRevealedFocus);
    return () => document.removeEventListener('visibilitychange', restoreRevealedFocus);
  }, []);
  async function openSettings() {
    try {
      if (window.desktop) await window.desktop.settings.open();
      else {
        const url = new URL(location.href);
        url.hash = 'settings';
        const opened = window.open(url, 'ai-settings', 'width=1000,height=720');
        opened?.focus();
      }
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function hide() {
    try {
      if (window.desktop) await window.desktop.hide();
      else setHidden(true);
    } catch (error) {
      showErrorToast(error);
    }
  }
  return { hidden, setHidden, openSettings, hide };
}
