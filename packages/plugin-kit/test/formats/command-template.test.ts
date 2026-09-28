import { describe, expect, it } from 'vitest';
import { parseCommandTemplate } from '../../src/formats/command-template.js';

describe('parseCommandTemplate (claude)', () => {
  it('maps $ARGUMENTS and 0-based $N / $ARGUMENTS[N] to 1-based argument segments', () => {
    expect(parseCommandTemplate('Fix $ARGUMENTS now', 'claude', [])).toEqual([
      { type: 'text', text: 'Fix ' },
      { type: 'arguments' },
      { type: 'text', text: ' now' },
    ]);
    expect(parseCommandTemplate('$0 to $1 via $ARGUMENTS[2]', 'claude', [])).toEqual([
      { type: 'argument', index: 1 },
      { type: 'text', text: ' to ' },
      { type: 'argument', index: 2 },
      { type: 'text', text: ' via ' },
      { type: 'argument', index: 3 },
    ]);
  });

  it('reads declared names, preferring the longest match', () => {
    expect(
      parseCommandTemplate('Fix $issue-number on $issue', 'claude', ['issue', 'issue-number']),
    ).toEqual([
      { type: 'text', text: 'Fix ' },
      { type: 'named', name: 'issue-number' },
      { type: 'text', text: ' on ' },
      { type: 'named', name: 'issue' },
    ]);
  });

  it('leaves undeclared names and a name followed by word characters as text', () => {
    expect(parseCommandTemplate('$branch and $issues', 'claude', ['issue'])).toEqual([
      { type: 'text', text: '$branch and $issues' },
    ]);
  });

  it('honours a single backslash escape and ignores doubled ones', () => {
    expect(parseCommandTemplate('Costs \\$1.00', 'claude', [])).toEqual([
      { type: 'text', text: 'Costs $1.00' },
    ]);
    expect(parseCommandTemplate('\\\\$1', 'claude', [])).toEqual([
      { type: 'text', text: '\\\\' },
      { type: 'argument', index: 2 },
    ]);
    expect(parseCommandTemplate('keep \\$HOME', 'claude', [])).toEqual([
      { type: 'text', text: 'keep \\$HOME' },
    ]);
  });
});

describe('parseCommandTemplate (pi)', () => {
  it('maps $@, $ARGUMENTS and 1-based $N', () => {
    expect(parseCommandTemplate('$1 and $@ and $ARGUMENTS', 'pi', [])).toEqual([
      { type: 'argument', index: 1 },
      { type: 'text', text: ' and ' },
      { type: 'arguments' },
      { type: 'text', text: ' and ' },
      { type: 'arguments' },
    ]);
  });

  it('keeps ${N:-default} fallbacks and reduces ${@...} forms to all arguments', () => {
    expect(parseCommandTemplate('Focus on ${1:-correctness}.', 'pi', [])).toEqual([
      { type: 'text', text: 'Focus on ' },
      { type: 'argument', index: 1, fallback: 'correctness' },
      { type: 'text', text: '.' },
    ]);
    expect(parseCommandTemplate('${@:-all} ${@:2} ${@:2:1}', 'pi', [])).toEqual([
      { type: 'arguments' },
      { type: 'text', text: ' ' },
      { type: 'arguments' },
      { type: 'text', text: ' ' },
      { type: 'arguments' },
    ]);
  });

  it('drops $0, resolves ${0:-x} to its default and merges the surrounding text', () => {
    expect(parseCommandTemplate('a$0b ${0:-c}d', 'pi', [])).toEqual([
      { type: 'text', text: 'ab cd' },
    ]);
  });

  it('does not treat declared names or backslashes specially', () => {
    expect(parseCommandTemplate('\\$name', 'pi', ['name'])).toEqual([
      { type: 'text', text: '\\$name' },
    ]);
  });
});
