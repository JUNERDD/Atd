import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { App } from '../App';
import { installBridge } from '../../tests/app-test-bridge';
import { setWindowActive } from '../window-state';

afterEach(() => {
  delete document.documentElement.dataset.windowActive;
  vi.unstubAllGlobals();
});

function editorOf(input: HTMLElement) {
  const view = EditorView.findFromDOM(input);
  if (!view) throw new Error('Expected a mounted composer editor.');
  return view;
}

describe('composer focus boundaries', () => {
  it('keeps one editable view through window-active changes and modal cancellation', async () => {
    const { api } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Task prompt' });
    const editor = editorOf(input);
    await user.type(input, 'before');
    for (let cycle = 0; cycle < 6; cycle += 1) {
      setWindowActive(false);
      input.blur();
      setWindowActive(true);
      await user.click(input);
      expect(input).toHaveFocus();
      expect(input.isContentEditable || input.getAttribute('contenteditable') === 'true').toBe(
        true,
      );
      await user.keyboard('{End}x');
      expect(editorOf(input)).toBe(editor);
    }
    await user.click(screen.getByRole('button', { name: 'Permission level' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Always allow/ }));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));
    await user.click(input);
    await user.keyboard('{End}after');
    expect(input).toHaveFocus();
    expect(editor.state.doc.toString()).toBe('beforexxxxxxafter');
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('destroys the editor and disconnects its observed DOM across remounts', async () => {
    const destroyed = vi.spyOn(EditorView.prototype, 'destroy');
    const observed = new Map<ResizeObserver, Set<Element>>();
    const ResizeBase = ResizeObserver;
    vi.stubGlobal(
      'ResizeObserver',
      class extends ResizeBase {
        override observe(target: Element) {
          const targets = observed.get(this) ?? new Set<Element>();
          targets.add(target);
          observed.set(this, targets);
        }
        override unobserve(target: Element) {
          const targets = observed.get(this);
          targets?.delete(target);
          if (!targets?.size) observed.delete(this);
        }
        override disconnect() {
          observed.delete(this);
        }
      },
    );
    const { api } = installBridge();
    const user = userEvent.setup();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const mounted = render(<App />);
      const input = screen.getByRole('textbox', { name: 'Task prompt' });
      const editor = editorOf(input);
      await user.type(input, 'retained draft');
      expect(editor.state.doc.toString()).toContain('retained draft');
      expect(observed.size).toBeGreaterThan(0);
      mounted.unmount();
      await waitFor(() =>
        expect(
          [...observed.values()].flatMap((nodes) =>
            [...nodes].map((node) => ({
              tag: node.tagName,
              name: node.className,
              connected: node.isConnected,
            })),
          ),
        ).toEqual([]),
      );
      expect(destroyed).toHaveBeenCalledTimes(cycle + 1);
      expect(input.isConnected).toBe(false);
      expect(document.querySelector('.cm-editor')).not.toBeInTheDocument();
    }
    expect(api.submit).not.toHaveBeenCalled();
  });
});
