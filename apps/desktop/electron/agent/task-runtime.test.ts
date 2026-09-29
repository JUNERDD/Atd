import { describe, expect, it } from 'vitest';
import type {
  ConfirmationRequest,
  InputRequest,
  PermissionAnswer,
} from '../../src/client/agent/permission-schema';
import { statusForPending, TaskRequests, validatePermissionAnswer } from './task-requests';

const confirmation: ConfirmationRequest = {
  kind: 'confirmation',
  id: 'req-confirm',
  taskId: 'task1',
  runId: 'run1',
  toolCallId: 'call1',
  scope: { tool: 'bash' },
  title: 'Run terminal command?',
  detail: 'ls',
};

const input: InputRequest = {
  kind: 'input',
  id: 'req-input',
  taskId: 'task1',
  runId: 'run1',
  toolCallId: 'call2',
  title: 'Which folder?',
  options: ['Home', 'Work'],
};

describe('answer shape validation', () => {
  it('accepts a decision for a confirmation and rejects input replies', () => {
    expect(() => validatePermissionAnswer(confirmation, { decision: 'once' })).not.toThrow();
    expect(() => validatePermissionAnswer(confirmation, { decision: 'session' })).not.toThrow();
    expect(() => validatePermissionAnswer(confirmation, { decision: 'declined' })).not.toThrow();
    expect(() => validatePermissionAnswer(confirmation, { answer: 'yes' })).toThrow(
      'Choose allow once, allow for this session, or decline.',
    );
    expect(() => validatePermissionAnswer(confirmation, { skipped: true })).toThrow(
      'Choose allow once, allow for this session, or decline.',
    );
  });

  it('accepts text or skip for an input and rejects a permission decision', () => {
    expect(() => validatePermissionAnswer(input, { answer: 'Home' })).not.toThrow();
    expect(() => validatePermissionAnswer(input, { skipped: true })).not.toThrow();
    expect(() => validatePermissionAnswer(input, { decision: 'once' })).toThrow(
      'Enter a response or skip this question.',
    );
    expect(() => validatePermissionAnswer(input, { answer: '   ' })).toThrow('Enter a response.');
  });
});

describe('request list ordering', () => {
  it('keeps pending requests oldest first and maps status from the oldest', async () => {
    const requests = new TaskRequests();
    const answers: PermissionAnswer[] = [];
    const first = new Promise<PermissionAnswer>((resolve) => requests.add(confirmation, resolve));
    const second = new Promise<PermissionAnswer>((resolve) => requests.add(input, resolve));
    expect(requests.list('task1').map((request) => request.id)).toEqual([
      'req-confirm',
      'req-input',
    ]);
    expect(statusForPending(requests.list('task1'))).toBe('awaiting_confirmation');
    expect(statusForPending(requests.remaining('run1', 'req-confirm'))).toBe('awaiting_input');
    const pending = requests.get('req-confirm');
    expect(pending?.request.kind).toBe('confirmation');
    validatePermissionAnswer(pending!.request, { decision: 'once' });
    requests.delete('req-confirm');
    pending!.resolve({ decision: 'once' });
    expect(requests.list('task1').map((request) => request.id)).toEqual(['req-input']);
    requests.dismiss('run1');
    answers.push(await first, await second);
    expect(answers).toEqual([{ decision: 'once' }, { skipped: true }]);
    expect(requests.list('task1')).toEqual([]);
    expect(statusForPending([])).toBe('running');
  });

  it('isolates request lists by task id', () => {
    const requests = new TaskRequests();
    requests.add(confirmation, () => undefined);
    requests.add({ ...input, id: 'req-other', taskId: 'task2' }, () => undefined);
    expect(requests.list('task1')).toEqual([confirmation]);
    expect(requests.list('task2')[0]?.id).toBe('req-other');
  });
});
