import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, TaskDetail } from '../../client/agent/bridge';
import { installBridge } from '../../../tests/app-test-bridge';
import { useTaskDetail } from './use-agent';

afterEach(() => vi.unstubAllGlobals());

function detail(taskId: string): TaskDetail {
  return {
    task: {
      id: taskId,
      title: taskId,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      sessionFile: null,
      runs: [],
      legacy: null,
    },
    artifacts: [],
    requests: [],
    queue: { steering: [], followUp: [] },
    context: {
      contextWindow: null,
      tokens: null,
      percent: null,
      compactions: 0,
      compacting: false,
    },
    revision: 0,
    blocks: [],
  };
}

function streamFixture() {
  const { api } = installBridge();
  const listeners = new Set<(event: AgentEvent) => void>();
  vi.spyOn(api, 'onChange').mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    api,
    listeners,
    frames,
    emit(revision: number, taskId = 'task-a') {
      const event: AgentEvent = {
        type: 'transcript',
        patch: {
          taskId,
          revision,
          snapshot: false,
          removed: [],
          blocks: [
            {
              kind: 'user',
              id: 'prompt',
              runId: 'run-a',
              timestamp: 0,
              endedAt: 0,
              text: `Patch ${revision}`,
              prompt: true,
            },
          ],
        },
      };
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe('task detail stream lifecycle', () => {
  it('coalesces a stream burst into one frame and cancels old work on task switch and unmount', async () => {
    const stream = streamFixture();
    vi.mocked(stream.api.detail).mockImplementation(async (taskId) => detail(taskId));
    const mounted = renderHook(({ taskId }) => useTaskDetail(taskId), {
      initialProps: { taskId: 'task-a' },
    });
    await waitFor(() => expect(mounted.result.current.detail?.task.id).toBe('task-a'));
    act(() => {
      for (let revision = 1; revision <= 200; revision += 1) stream.emit(revision);
    });
    expect(stream.frames.size).toBe(1);
    expect(mounted.result.current.detail?.revision).toBe(0);
    const callbacks = [...stream.frames.values()];
    stream.frames.clear();
    act(() => callbacks.forEach((callback) => callback(16)));
    expect(mounted.result.current.detail?.revision).toBe(200);
    expect(mounted.result.current.detail?.blocks).toEqual([
      expect.objectContaining({ text: 'Patch 200' }),
    ]);
    act(() => stream.emit(201));
    expect(stream.frames.size).toBe(1);
    mounted.rerender({ taskId: 'task-b' });
    expect(stream.frames.size).toBe(0);
    await waitFor(() => expect(mounted.result.current.detail?.task.id).toBe('task-b'));
    expect(stream.listeners.size).toBe(1);
    act(() => stream.emit(1, 'task-b'));
    expect(stream.frames.size).toBe(1);
    mounted.unmount();
    expect(stream.frames.size).toBe(0);
    expect(stream.listeners.size).toBe(0);
  });

  it('ignores a seed that resolves after the hook switched tasks', async () => {
    const stream = streamFixture();
    let resolveFirst: (value: TaskDetail) => void = () => {};
    const first = new Promise<TaskDetail>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(stream.api.detail).mockImplementation((taskId) =>
      taskId === 'task-a' ? first : Promise.resolve(detail(taskId)),
    );
    const mounted = renderHook(({ taskId }) => useTaskDetail(taskId), {
      initialProps: { taskId: 'task-a' },
    });
    mounted.rerender({ taskId: 'task-b' });
    await waitFor(() => expect(mounted.result.current.detail?.task.id).toBe('task-b'));
    await act(async () => resolveFirst(detail('task-a')));
    expect(mounted.result.current.detail?.task.id).toBe('task-b');
    expect(stream.listeners.size).toBe(1);
    mounted.unmount();
    expect(stream.listeners.size).toBe(0);
  });
});
