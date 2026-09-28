import { describe, expect, it } from 'vitest';
import { menuBarStatus, menuBarTooltip } from './menu-bar-status';

describe('menu bar status', () => {
  it('ranks waiting tasks above running ones and counts each task once', () => {
    const status = menuBarStatus(
      [
        { status: 'running', pendingRequests: 0 },
        { status: 'queued', pendingRequests: 0 },
        { status: 'awaiting_confirmation', pendingRequests: 1 },
        { status: 'running', pendingRequests: 1 },
        { status: 'completed', pendingRequests: 0 },
        { status: undefined, pendingRequests: 0 },
      ],
      'connected',
    );
    expect(status).toEqual({ state: 'attention', running: 2, attention: 2 });
    expect(menuBarTooltip(status)).toBe('AI · 2 running · 2 waiting for you');
  });

  it('reads running and idle from finished or active runs', () => {
    expect(menuBarStatus([{ status: 'stopping', pendingRequests: 0 }], 'connected').state).toBe(
      'running',
    );
    const idle = menuBarStatus([{ status: 'failed', pendingRequests: 0 }], 'connected');
    expect(idle).toEqual({ state: 'idle', running: 0, attention: 0 });
    expect(menuBarTooltip(idle)).toBe('AI');
  });

  it('shows an unavailable service over stale task states, but not while connecting', () => {
    const tasks = [{ status: 'awaiting_input' as const, pendingRequests: 0 }];
    const unavailable = menuBarStatus(tasks, 'disconnected');
    expect(unavailable.state).toBe('unavailable');
    expect(menuBarStatus(tasks, 'reconnecting').state).toBe('unavailable');
    expect(menuBarTooltip(unavailable)).toBe('AI · Service unavailable');
    expect(menuBarStatus(tasks, 'connecting').state).toBe('attention');
  });
});
