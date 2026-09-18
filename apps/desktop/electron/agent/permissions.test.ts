import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  grantKey,
  type GrantScope,
  type PermissionOutcome,
  type PermissionRecord,
  type PermissionTier,
} from './permission-schema';
import { locationOf, PermissionGate, type PermissionGateHost } from './permissions';
import type { AgentTask } from './task-schema';

const SCOPES: GrantScope[] = [
  { tool: 'read', location: 'inside' },
  { tool: 'read', location: 'outside' },
  { tool: 'write', location: 'inside' },
  { tool: 'write', location: 'outside' },
  { tool: 'edit', location: 'inside' },
  { tool: 'edit', location: 'outside' },
  { tool: 'bash' },
  { tool: 'command' },
];

function allowsWithoutPrompt(tier: PermissionTier, scope: GrantScope) {
  if (tier === 'always') return true;
  if (scope.tool === 'read' && 'location' in scope && scope.location === 'inside') return true;
  return tier === 'auto' && 'location' in scope && scope.location === 'inside';
}

function task(id: string, permissionTier: PermissionTier): AgentTask {
  return {
    id,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sessionFile: null,
    runs: [],
    legacy: null,
    permissionTier,
  };
}

function gateFor(
  tasks: Record<string, PermissionTier>,
  ask: PermissionGateHost['ask'],
  record: PermissionGateHost['record'] = async () => undefined,
) {
  return {
    gate: new PermissionGate({
      task: (id) => task(id, tasks[id] ?? 'manual'),
      ask,
      record,
    }),
    ask,
    record,
  };
}

describe('locationOf', () => {
  const folder = path.join('tasks', 'task1', 'output');
  it('treats the task folder and its children as inside', () => {
    expect(locationOf(folder, folder)).toBe('inside');
    expect(locationOf(path.join(folder, 'note.txt'), folder)).toBe('inside');
  });
  it('treats a sibling path as outside', () => {
    expect(locationOf(`${folder}-extra`, folder)).toBe('outside');
    expect(locationOf(path.join('other', 'file.txt'), folder)).toBe('outside');
  });
});

describe('PermissionGate tier matrix', () => {
  it.each(['manual', 'auto', 'always'] as const)(
    '%s allows the documented scopes without prompting',
    async (tier) => {
      const ask = vi.fn(async () => ({ decision: 'once' as const }));
      const record = vi.fn(async () => undefined);
      const { gate } = gateFor({ task1: tier }, ask, record);
      for (const scope of SCOPES) {
        ask.mockClear();
        record.mockClear();
        const outcome = await gate.decide({
          taskId: 'task1',
          runId: 'run1',
          toolCallId: `call-${grantKey(scope)}`,
          scope,
          title: 'Approve?',
          detail: grantKey(scope),
        });
        if (allowsWithoutPrompt(tier, scope)) {
          expect(outcome).toBe('tier');
          expect(ask).not.toHaveBeenCalled();
        } else {
          expect(outcome).toBe('once');
          expect(ask).toHaveBeenCalledTimes(1);
        }
        expect(record).toHaveBeenCalledWith(
          'task1',
          expect.objectContaining({
            toolCallId: `call-${grantKey(scope)}`,
            runId: 'run1',
            scope,
            outcome,
          }),
        );
      }
    },
  );
});

describe('PermissionGate session grants', () => {
  const scope: GrantScope = { tool: 'bash' };

  it('reuses a session grant within a task and isolates it from other tasks', async () => {
    const ask = vi.fn(async () => ({ decision: 'session' as const }));
    const records: PermissionRecord[] = [];
    const { gate } = gateFor({ task1: 'manual', task2: 'manual' }, ask, async (_taskId, record) => {
      records.push(record);
    });
    const input = {
      runId: 'run1',
      toolCallId: 'call1',
      scope,
      title: 'Run terminal command?',
      detail: 'ls',
    };
    expect(await gate.decide({ ...input, taskId: 'task1' })).toBe('session');
    expect(await gate.decide({ ...input, taskId: 'task1', toolCallId: 'call2' })).toBe('grant');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await gate.decide({ ...input, taskId: 'task2', toolCallId: 'call3' })).toBe('session');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(records.map((record) => record.outcome)).toEqual(['session', 'grant', 'session']);
  });

  it('does not reuse a once decision as a grant', async () => {
    const ask = vi.fn(async () => ({ decision: 'once' as const }));
    const { gate } = gateFor({ task1: 'manual' }, ask);
    const input = {
      taskId: 'task1',
      runId: 'run1',
      toolCallId: 'call1',
      scope,
      title: 'Run terminal command?',
      detail: 'ls',
    };
    expect(await gate.decide(input)).toBe('once');
    expect(await gate.decide({ ...input, toolCallId: 'call2' })).toBe('once');
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe('PermissionGate decline and records', () => {
  it('records a decline, reports it, and lets the caller throw', async () => {
    const records: PermissionRecord[] = [];
    const ask = vi.fn(async () => ({ decision: 'declined' as const }));
    const { gate } = gateFor({ task1: 'manual' }, ask, async (_taskId, record) => {
      records.push(record);
    });
    const outcome = await gate.decide({
      taskId: 'task1',
      runId: 'run1',
      toolCallId: 'call1',
      scope: { tool: 'command' },
      title: 'Create the command "Draft"?',
      detail: 'Name: Draft',
    });
    expect(outcome).toBe('declined');
    expect(records).toEqual([
      expect.objectContaining({
        toolCallId: 'call1',
        runId: 'run1',
        scope: { tool: 'command' },
        outcome: 'declined',
      }),
    ]);
    expect(typeof records[0]?.at).toBe('number');
    expect(() => {
      if (outcome === 'declined') throw new Error('The user declined this action.');
    }).toThrow('The user declined this action.');
  });

  it('still returns the outcome when recording fails', async () => {
    const failed = vi.fn();
    const gate = new PermissionGate({
      task: () => task('task1', 'always'),
      ask: async () => ({ decision: 'once' }),
      record: async () => {
        throw new Error('worker offline');
      },
      failed,
    });
    await expect(
      gate.decide({
        taskId: 'task1',
        runId: 'run1',
        toolCallId: 'call1',
        scope: { tool: 'read', location: 'inside' },
        title: 'Read this file?',
        detail: '/tmp/a',
      }),
    ).resolves.toBe<PermissionOutcome>('tier');
    expect(failed).toHaveBeenCalledWith('task1', expect.stringContaining('worker offline'));
  });
});
