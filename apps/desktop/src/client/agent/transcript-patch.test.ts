import { describe, expect, it } from 'vitest';
import { applyTranscriptPatch, type Block, type TranscriptPatch } from './transcript-schema';

function block(id: string, text = id): Block {
  return { kind: 'user', id, text, runId: 'test-run', timestamp: 0, endedAt: 0, prompt: true };
}

function patch(revision: number, blocks: Block[], removed: string[] = []): TranscriptPatch {
  return { taskId: 'test-task', revision, snapshot: false, blocks, removed };
}

describe('incremental transcript publications', () => {
  it('retains unchanged blocks, replaces in place, and appends new or reintroduced IDs', () => {
    const original = [block('a'), block('b'), block('c'), block('d')];
    const replacement = block('b', 'updated');
    const reintroduced = block('a', 'reintroduced');
    const appended = block('e');
    const result = applyTranscriptPatch(
      { revision: 4, blocks: original },
      patch(5, [appended, replacement, reintroduced], ['a', 'c']),
    );
    expect(result).toEqual({
      revision: 5,
      blocks: [replacement, original[3], appended, reintroduced],
    });
    expect(result?.blocks[1]).toBe(original[3]);
    expect(original.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(original[1]).not.toBe(replacement);
  });

  it('takes the last publication of repeated IDs while preserving their insertion order', () => {
    const lastExisting = block('a', 'last existing');
    const lastNew = block('b', 'last new');
    const result = applyTranscriptPatch(
      { revision: 0, blocks: [block('a')] },
      patch(1, [block('b'), block('a', 'first'), block('c'), lastNew, lastExisting]),
    );
    expect(result?.blocks).toEqual([lastExisting, lastNew, block('c')]);
  });

  it('refuses a revision gap and takes snapshots atomically', () => {
    const current = { revision: 3, blocks: [block('old')] };
    expect(applyTranscriptPatch(current, patch(5, [block('late')]))).toBeNull();
    const snapshot = { ...patch(12, [block('new')]), snapshot: true };
    const next = applyTranscriptPatch(current, snapshot);
    expect(next).toEqual({ revision: 12, blocks: snapshot.blocks });
    expect(next?.blocks).toBe(snapshot.blocks);
    expect(current).toEqual({ revision: 3, blocks: [block('old')] });
  });

  it('keeps the document order and final values across mixed update and removal bursts', () => {
    const expected = new Map<string, Block>();
    let current = { revision: 0, blocks: [] as Block[] };
    for (let revision = 1; revision <= 500; revision++) {
      const removed = [String(revision % 31)];
      const changes = [
        block(String(revision % 53), `text ${revision}`),
        block(String(revision % 7)),
      ];
      for (const id of removed) expected.delete(id);
      for (const item of changes) expected.set(item.id, item);
      const next = applyTranscriptPatch(current, patch(revision, changes, removed));
      expect(next?.blocks).toEqual([...expected.values()]);
      if (!next) throw new Error('Contiguous revision refused');
      current = next;
    }
  });
});
