import { expect, it } from 'vitest';
import { reviewChanges } from './light-review-changes';

it.each([
  ['The meeting is on Monday at noon.', 'The meeting is on Tuesday at noon.'],
  ['今天下午我们一起讨论这个方案。', '今天晚上我们一起讨论这个方案。'],
  ['The  first line.\nThe second line.', 'The first line.\nThe revised second line.'],
])('marks a rewrite and preserves its exact result, including whitespace', (source, answer) => {
  const changes = reviewChanges(source, answer);
  expect(changes).toBeDefined();
  expect(changes?.some((change) => change.kind !== 'same')).toBe(true);
  expect(
    changes
      ?.filter((change) => change.kind !== 'delete')
      .map((change) => change.text)
      .join(''),
  ).toBe(answer);
});

it.each([
  [undefined, 'Hello world'],
  ['Hello', 'Hello'],
  ['你好世界', 'Hello world'],
  [' \n', '\t'],
  ['a'.repeat(40_001), 'Too long'],
])('omits misleading or excessive change marks', (source, answer) => {
  expect(reviewChanges(source, answer)).toBeUndefined();
});
