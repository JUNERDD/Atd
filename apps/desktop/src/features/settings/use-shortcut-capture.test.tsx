import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../../client/contract';
import { useShortcutCapture } from './use-shortcut-capture';

/** Starts a recording in the macOS shell, which pauses native shortcuts until it is released. */
async function record() {
  const release = vi.fn();
  const bridge: Pick<DesktopBridge, 'platform' | 'beginShortcutRecording'> = {
    platform: 'darwin',
    beginShortcutRecording: async () => release,
  };
  window.desktop = bridge as DesktopBridge;
  const onRecorded = vi.fn();
  const onCancel = vi.fn();
  const { result } = renderHook(() => useShortcutCapture({ onRecorded, onCancel }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.isRecording).toBe(true));
  return { result, release, onRecorded, onCancel };
}

describe('shortcut capture', () => {
  it('records the physical key with the modifiers held and resumes native shortcuts', async () => {
    const { result, release, onRecorded } = await record();
    // On AZERTY the key a US layout prints Q types "a"; the shell registers the physical key.
    fireEvent.keyDown(document.body, { key: 'a', code: 'KeyQ', metaKey: true, shiftKey: true });
    expect(onRecorded).toHaveBeenCalledExactlyOnceWith('CommandOrControl+Shift+Q');
    expect(release).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });

  it.each([
    ['a keypad key', { key: '1', code: 'Numpad1', metaKey: true }],
    ['a key without a physical code', { key: 'k', code: '', metaKey: true }],
  ])('completes with nothing for %s', async (_case, init) => {
    const { release, onRecorded } = await record();
    fireEvent.keyDown(document.body, init);
    expect(onRecorded).toHaveBeenCalledExactlyOnceWith(null);
    expect(release).toHaveBeenCalledOnce();
  });

  it('records Backspace as a key rather than clearing the shortcut', async () => {
    const { onRecorded } = await record();
    fireEvent.keyDown(document.body, { key: 'Backspace', code: 'Backspace' });
    expect(onRecorded).toHaveBeenCalledExactlyOnceWith('Backspace');
  });

  it('cancels once on Tab and leaves the focus move to the browser', async () => {
    const { result, release, onRecorded, onCancel } = await record();
    expect(fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });

  it('cancels once on Escape without the key reaching the page', async () => {
    const { onRecorded, onCancel } = await record();
    const page = vi.fn();
    document.addEventListener('keydown', page);
    try {
      expect(fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })).toBe(false);
    } finally {
      document.removeEventListener('keydown', page);
    }
    expect(page).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
