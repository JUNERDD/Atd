import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setWindowVisible } from '../window-state';
import { useShaderClock } from './use-shader-clock';

afterEach(() => {
  delete document.documentElement.dataset.windowVisible;
  vi.unstubAllGlobals();
});

function frameClock() {
  let now = 0;
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++next;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  return {
    pending,
    step(milliseconds: number) {
      now += milliseconds;
      const callbacks = [...pending.values()];
      pending.clear();
      act(() => callbacks.forEach((callback) => callback(now)));
    },
  };
}

// The real hook runs against an instrumented frame scheduler. GPU allocation and WebKit
// compositing need native measurements; these cases establish JS scheduling and listener lifetime.
describe('shader clock resource lifetime', () => {
  it('pauses for either visibility signal and never accumulates frame loops on resume', () => {
    const clock = frameClock();
    const draw = vi.fn((_element: HTMLElement, _milliseconds: number) => false);
    const ref = {
      current: Object.assign(document.createElement('div'), { paperShaderMount: undefined }),
    };
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const mounted = renderHook(() => useShaderClock(ref, 0, true, 50, 0, draw));
    expect(clock.pending.size).toBe(1);
    expect(draw).toHaveBeenCalledTimes(1);
    clock.step(16);
    expect(draw).toHaveBeenCalledTimes(1);
    clock.step(34);
    expect(draw).toHaveBeenCalledTimes(2);
    for (let cycle = 0; cycle < 30; cycle += 1) {
      act(() => setWindowVisible(false));
      expect(clock.pending.size).toBe(0);
      act(() => setWindowVisible(true));
      expect(clock.pending.size).toBe(1);
    }
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(clock.pending.size).toBe(0);
    act(() => setWindowVisible(true));
    expect(clock.pending.size).toBe(0);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(clock.pending.size).toBe(1);
    mounted.unmount();
    expect(clock.pending.size).toBe(0);
    act(() => {
      setWindowVisible(false);
      setWindowVisible(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(clock.pending.size).toBe(0);
  });

  it('cancels every stopped run and removes callbacks when an active clock unmounts', () => {
    const clock = frameClock();
    const draw = vi.fn((_element: HTMLElement, _milliseconds: number) => false);
    const ref = {
      current: Object.assign(document.createElement('div'), { paperShaderMount: undefined }),
    };
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const mounted = renderHook(({ run }) => useShaderClock(ref, 0, run, 50, 0, draw), {
      initialProps: { run: false },
    });
    for (let cycle = 0; cycle < 30; cycle += 1) {
      mounted.rerender({ run: true });
      expect(clock.pending.size).toBe(1);
      clock.step(50);
      expect(clock.pending.size).toBe(1);
      mounted.rerender({ run: false });
      expect(clock.pending.size).toBe(0);
      expect(draw.mock.lastCall?.[1]).toBe(0);
    }
    mounted.rerender({ run: true });
    mounted.unmount();
    expect(clock.pending.size).toBe(0);
    const paints = draw.mock.calls.length;
    act(() => {
      setWindowVisible(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    clock.step(1000);
    expect(draw).toHaveBeenCalledTimes(paints);
    expect(clock.pending.size).toBe(0);
  });
});
