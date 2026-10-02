import { describe, expect, it } from 'vitest';
import type { FolderRef } from '@atd/agent-contracts';
import { emptyInput, type TaskRun } from '../../client/agent/task-schema';
import { replacementRequest } from '../agent/transcript/turn-resend';
import { appendChip, draftChips, serialize, type ComposerDraft } from './draft';
import { draftFolders, folderChip } from './draft-attachments';

const project: FolderRef = { id: 'folder-1', name: 'my project', path: '/Users/me/my project' };
const notes: FolderRef = { id: 'folder-2', name: 'notes', path: '/Users/me/notes' };

describe('folder chips', () => {
  it('serialize as their name and record only the id and name', () => {
    const draft = serialize(['Read ', folderChip(project), ' and ', folderChip(notes)]);
    expect(draft.text).toBe('Read @"my project" and @notes');
    expect(draftChips(draft)).toEqual([
      { from: 5, to: 18, chip: { kind: 'folder', folderId: 'folder-1', name: 'my project' } },
      { from: 23, to: 29, chip: { kind: 'folder', folderId: 'folder-2', name: 'notes' } },
    ]);
    // The chip keeps the path for its tooltip while drafting; the record never carries it.
    expect(draft.chips[0]?.chip).toEqual({
      kind: 'folder',
      folderId: 'folder-1',
      name: 'my project',
      path: '/Users/me/my project',
    });
  });

  it('send each folder once, in draft order, up to the contract cap', () => {
    let draft: ComposerDraft = serialize([folderChip(notes), ' ', folderChip(project)]);
    draft = appendChip(draft, folderChip(notes));
    expect(draftFolders(draft)).toEqual(['folder-2', 'folder-1']);
    const many = serialize(
      Array.from({ length: 12 }, (_, index) =>
        folderChip({ id: `f${index}`, name: `f${index}`, path: `/f${index}` }),
      ),
    );
    expect(draftFolders(many)).toHaveLength(10);
    expect(draftFolders({ text: 'no folders', chips: [] })).toEqual([]);
  });

  it('come back on edit-and-resend while their token stays, and leave with it', () => {
    const sent = serialize(['Read ', folderChip(project), ' and ', folderChip(notes)]);
    const run = {
      id: 'run-1',
      snapshot: {
        input: {
          ...emptyInput(),
          text: sent.text,
          chips: draftChips(sent),
          folders: draftFolders(sent),
        },
        instructions: '',
        tools: [],
        memory: true,
        model: { connectionId: 'c', modelId: 'm', provider: 'openai', baseUrl: '' },
      },
    } as unknown as TaskRun;
    const user = {
      kind: 'user' as const,
      id: 'u:1:0',
      runId: 'run-1',
      timestamp: 0,
      endedAt: 0,
      text: sent.text,
      prompt: true as const,
      entryId: 'entry-1',
    };
    const request = replacementRequest('task-1', user, [run], run, 'Only @notes please');
    expect(request.input.folders).toEqual(['folder-2']);
    expect(request.input.chips).toEqual([
      { from: 5, to: 11, chip: { kind: 'folder', folderId: 'folder-2', name: 'notes' } },
    ]);
  });
});
