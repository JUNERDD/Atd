import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { App } from '../../App';
import { installBridge } from '../../../tests/app-test-bridge';
import { editorDraft } from '../composer-editor/chip-state';

function draftOf(textbox: HTMLElement) {
  const view = EditorView.findFromDOM(textbox);
  if (!view) throw new Error('The composer editor is not mounted.');
  return editorDraft(view.state);
}

describe('selection toolbar Ask Atd', () => {
  it('quotes the captured selection into the draft without sending it', async () => {
    const { api, askSelection } = installBridge();
    vi.mocked(api.capture).mockResolvedValueOnce({
      text: 'The quarterly numbers\nare in.',
      capturedAt: '2026-10-02T12:00:00.000Z',
    });
    render(<App />);
    const textbox = screen.getByRole('textbox', { name: 'Task prompt' });
    act(() => askSelection());
    await waitFor(() => expect(draftOf(textbox).chips).toHaveLength(1));
    expect(api.capture).toHaveBeenCalledWith('selection');
    expect(draftOf(textbox).chips[0]?.chip).toEqual({
      kind: 'quote',
      text: 'The quarterly numbers\nare in.',
    });
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('shows why a capture failed and leaves the draft alone', async () => {
    const { api, askSelection } = installBridge();
    vi.mocked(api.capture).mockRejectedValueOnce(
      new Error('No selected text — select text in another app, then use the command shortcut.'),
    );
    render(<App />);
    act(() => askSelection());
    expect(await screen.findByRole('status')).toHaveTextContent('No selected text');
    expect(draftOf(screen.getByRole('textbox', { name: 'Task prompt' })).chips).toEqual([]);
  });
});
