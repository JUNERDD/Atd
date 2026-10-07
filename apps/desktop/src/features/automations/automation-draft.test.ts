import { describe, expect, it } from 'vitest';
import { automationItem, systemZone } from '../../../tests/automation-fixtures';
import { copyDraft, needsNewTime } from './automation-draft';

const copy = (name: string) => `${name} copy`;

describe('automation drafts', () => {
  it('names a copy within the 120 characters a name may have, starting off', () => {
    const short = copyDraft(automationItem({ id: 'a', name: 'Morning brief' }).automation, copy);
    expect(short).toMatchObject({ name: 'Morning brief copy', enabled: false });
    const long = copyDraft(automationItem({ id: 'b', name: 'x'.repeat(119) }).automation, copy);
    expect(long.name).toHaveLength(120);
    expect(long.name.endsWith('x copy')).toBe(true);
    // Whole characters only: a cut never splits a character made of two code units.
    const emoji = copyDraft(automationItem({ id: 'c', name: '😀'.repeat(60) }).automation, copy);
    expect(emoji.name.length).toBeLessThanOrEqual(120);
    expect(emoji.name).toBe(`${'😀'.repeat(57)} copy`);
  });

  it('asks for a new time only for a one-time schedule whose time has passed', () => {
    const once = (at: string) =>
      automationItem({
        id: 'once',
        name: 'Once',
        trigger: { kind: 'schedule', schedule: { kind: 'once', at }, timezone: systemZone },
      }).automation;
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(needsNewTime(once('2026-10-06T09:00:00Z'), now)).toBe(true);
    expect(needsNewTime(once('2026-10-07T09:00:00Z'), now)).toBe(false);
    expect(needsNewTime(automationItem({ id: 'daily', name: 'Daily' }).automation, now)).toBe(
      false,
    );
  });
});
