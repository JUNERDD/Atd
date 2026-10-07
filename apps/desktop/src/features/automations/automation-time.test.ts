import { describe, expect, it } from 'vitest';
import { zonedIso, zonedLocal } from './automation-time';

describe('one-time schedule times', () => {
  it('keeps an ordinary wall time with its zone’s offset', () => {
    expect(zonedIso('2026-10-07T09:00', 'Asia/Shanghai')).toBe('2026-10-07T09:00:00+08:00');
    expect(zonedIso('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T09:00:00-04:00');
    expect(zonedLocal('2026-07-01T09:00:00-04:00', 'America/New_York')).toBe('2026-07-01T09:00');
  });

  it('moves a time a spring-forward change skips forward by the gap', () => {
    const iso = zonedIso('2026-03-08T02:30', 'America/New_York');
    expect(iso).toBe('2026-03-08T03:30:00-04:00');
    expect(zonedLocal(iso ?? '', 'America/New_York')).toBe('2026-03-08T03:30');
    expect(zonedIso('2026-03-29T02:30', 'Europe/Berlin')).toBe('2026-03-29T03:30:00+02:00');
    expect(zonedIso('2026-10-04T02:30', 'Australia/Sydney')).toBe('2026-10-04T03:30:00+11:00');
  });

  it('takes the first of the two times a fall-back change repeats', () => {
    expect(zonedIso('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T01:30:00-04:00');
  });

  it('refuses an incomplete value or an unknown zone', () => {
    expect(zonedIso('2026-03-08', 'America/New_York')).toBeNull();
    expect(zonedIso('2026-03-08T09:00', 'Mars/Olympus_Mons')).toBeNull();
  });
});
