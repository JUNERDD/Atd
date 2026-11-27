import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '@atd/ui/components/dialog';
import { useSettingsKeys } from './use-settings-keys';

function SettingsKeys({
  disabled = false,
  dialog = false,
  actions,
}: {
  disabled?: boolean;
  dialog?: boolean;
  actions: Parameters<typeof useSettingsKeys>[1];
}) {
  useSettingsKeys(disabled, actions);
  return (
    <>
      <input aria-label="Name" />
      <button type="button">Toggle</button>
      <button type="button" onKeyDown={(event) => event.preventDefault()}>
        Handles keys
      </button>
      <Dialog open={dialog}>
        <DialogContent showCloseButton={false} aria-describedby={undefined}>
          <DialogTitle>Confirm</DialogTitle>
          <button type="button">Inside dialog</button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function mount({ dialog = false } = {}) {
  const actions = { search: vi.fn(), back: vi.fn(), forward: vi.fn() };
  const view = render(<SettingsKeys dialog={dialog} actions={actions} />);
  return { actions, view };
}

/** One press: whether the page kept the key's default action (`false` once a shortcut took it). */
function press(target: Element, init: KeyboardEventInit) {
  const kept = fireEvent.keyDown(target, init);
  fireEvent.keyUp(target, init);
  return kept;
}

describe('settings window keys', () => {
  it('matches ⌘F, ⌘[ and ⌘] by the character the key types', () => {
    const { actions } = mount();
    expect(press(document.body, { key: 'f', code: 'KeyF', metaKey: true })).toBe(false);
    // Dvorak types [ and ] on the keys a US layout prints - and = on.
    press(document.body, { key: '[', code: 'Minus', metaKey: true });
    press(document.body, { key: ']', code: 'Equal', metaKey: true });
    // ... and / on the key a US layout prints [ on.
    expect(press(document.body, { key: '/', code: 'BracketLeft', metaKey: true })).toBe(true);
    expect(actions.search).toHaveBeenCalledOnce();
    expect(actions.back).toHaveBeenCalledOnce();
    expect(actions.forward).toHaveBeenCalledOnce();
  });

  it('treats another modifier with ⌘, or no ⌘, as a different shortcut', () => {
    const { actions } = mount();
    press(document.body, { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true });
    press(document.body, { key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true });
    press(document.body, { key: '[', code: 'BracketLeft', metaKey: true, ctrlKey: true });
    press(document.body, { key: 'f', code: 'KeyF', ctrlKey: true });
    press(document.body, { key: '[', code: 'BracketLeft' });
    expect(actions.search).not.toHaveBeenCalled();
    expect(actions.back).not.toHaveBeenCalled();
  });

  it('leaves keys to text fields and to controls that handled them', () => {
    const { actions } = mount();
    const back = { key: '[', code: 'BracketLeft', metaKey: true };
    expect(press(screen.getByRole('textbox', { name: 'Name' }), back)).toBe(true);
    press(screen.getByRole('button', { name: 'Handles keys' }), back);
    expect(actions.back).not.toHaveBeenCalled();
    press(screen.getByRole('button', { name: 'Toggle' }), back);
    expect(actions.back).toHaveBeenCalledOnce();
  });

  it('leaves keys to an open dialog', () => {
    const { actions } = mount({ dialog: true });
    const back = { key: '[', code: 'BracketLeft', metaKey: true };
    expect(press(screen.getByRole('button', { name: 'Inside dialog' }), back)).toBe(true);
    expect(actions.back).not.toHaveBeenCalled();
  });

  it('acts once per physical press, and not at all while a shortcut is recorded', () => {
    const { actions, view } = mount();
    const search = { key: 'f', code: 'KeyF', metaKey: true };
    fireEvent.keyDown(document.body, search);
    fireEvent.keyDown(document.body, { ...search, repeat: true });
    fireEvent.keyUp(document.body, search);
    expect(actions.search).toHaveBeenCalledOnce();
    view.rerender(<SettingsKeys disabled actions={actions} />);
    press(document.body, search);
    expect(actions.search).toHaveBeenCalledOnce();
  });
});
