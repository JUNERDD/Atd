import { describe, expect, it, vi } from 'vitest';
import { createTask, loadState, saveState, STORAGE_KEY } from './task-store';

describe('local task persistence', () => {
  it('rejects empty tasks and accepts context-only tasks', () => {
    expect(createTask(' \n ', [])).toBeNull();
    expect(
      createTask('', [{ id: 'file', name: 'brief.txt', size: 42, type: 'text/plain' }]),
    ).toMatchObject({ prompt: '', attachments: [{ name: 'brief.txt' }] });
  });

  it('restores saved data and drops malformed tasks from old or corrupt data', () => {
    const task = createTask('  Plan my day  ', [])!;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        pinned: false,
        tasks: [task, { prompt: 'broken', attachments: null }],
      }),
    );
    expect(loadState()).toEqual({ pinned: false, tasks: [task] });
    localStorage.setItem(STORAGE_KEY, '{invalid json');
    expect(loadState()).toEqual({ tasks: [], pinned: true });
  });

  it('does not claim durable saving when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    expect(saveState({ tasks: [], pinned: true })).toBe(false);
  });

  it('recovers when browser storage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(loadState()).toEqual({ tasks: [], pinned: true });
  });
});
