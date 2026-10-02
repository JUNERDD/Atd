import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { FolderBridge } from '../client/contract';
import { App } from '../App';
import { installBridge } from '../../tests/app-test-bridge';
import { editorDraft } from '../features/composer-editor/chip-state';

function draftOf(textbox: HTMLElement) {
  const view = EditorView.findFromDOM(textbox);
  if (!view) throw new Error('The composer editor is not mounted.');
  return editorDraft(view.state);
}

function folderBridge(): FolderBridge {
  return {
    pick: vi.fn(async () => ({
      folders: [{ id: 'folder-1', name: 'project', path: '/Users/me/project' }],
      failures: [{ name: 'notes.txt', reason: 'notDirectory' as const }],
    })),
    list: vi.fn(async () => []),
    revoke: vi.fn(async () => []),
    onChange: () => () => {},
  };
}

describe('composer folders', () => {
  it('adds a picked folder as a chip with its path and grants it with the message', async () => {
    const folders = folderBridge();
    const { api } = installBridge({ folders });
    const user = userEvent.setup();
    render(<App />);
    const textbox = screen.getByRole('textbox', { name: 'Task prompt' });
    await user.click(screen.getByRole('button', { name: 'Attach context' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add folder…' }));
    // A refused pick explains itself; the registered folder becomes a chip.
    expect(await screen.findByRole('status')).toHaveTextContent('notes.txt is not a folder.');
    await waitFor(() => expect(draftOf(textbox).text).toBe('@project '));
    expect(screen.getByTitle('Folder: /Users/me/project')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send task' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    expect(api.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          folders: ['folder-1'],
          chips: [
            { from: 0, to: 8, chip: { kind: 'folder', folderId: 'folder-1', name: 'project' } },
          ],
        }),
      }),
    );
  });

  it('always sends the folder list, empty without folder chips', async () => {
    const { api } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox', { name: 'Task prompt' }), 'Plan my day{Enter}');
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    expect(api.submit).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ folders: [] }) }),
    );
  });
});
