import { afterEach, describe, expect, it, vi } from 'vitest';
import { showErrorToast } from '../../components/toast-store';
import { installDiagnosticsCapture } from '../../native-host/diagnostics';
import {
  BREADCRUMB_MAX_ENTRIES,
  BREADCRUMB_MAX_ENTRY_BYTES,
  BREADCRUMB_MAX_TOTAL_BYTES,
  DiagnosticsBreadcrumbs,
  detachText320,
  diagnosticsBreadcrumbs,
} from './breadcrumbs';

describe('DiagnosticsBreadcrumbs', () => {
  afterEach(() => {
    diagnosticsBreadcrumbs.clear();
  });

  it('detaches and truncates to <= 320 code units without leaving lone surrogates', () => {
    const base = 'a'.repeat(319);
    const emoji = '😀'; // surrogate pair (2 UTF-16 code units)
    const huge = `${base}${emoji}${'z'.repeat(4096)}`;
    const detached = detachText320(huge);

    expect(detached.length).toBe(320);
    // Trailing lone high surrogate at index 319 is replaced with U+FFFD rather than left unpaired.
    expect(detached.endsWith('\uFFFD')).toBe(true);
    expect(detached.codePointAt(319)).toBe(0xfffd);
  });

  it('enforces 128-entry and 1024-byte per-entry caps even under JSON escaping', () => {
    const ring = new DiagnosticsBreadcrumbs();
    const encoder = new TextEncoder();
    const controlBurst = '\u0001'.repeat(320);

    for (let i = 0; i < 150; i += 1) {
      ring.record({
        category: 'query_error',
        code: 'internal',
        name: 'Error',
        message: i === 0 ? controlBurst : `error-${i}-${'x'.repeat(280)}`,
      });
    }

    const snap = ring.snapshot();
    expect(snap.entries.length).toBeLessThanOrEqual(BREADCRUMB_MAX_ENTRIES);
    expect(snap.droppedCount).toBeGreaterThanOrEqual(22);

    for (const entry of snap.entries) {
      expect(encoder.encode(JSON.stringify(entry)).byteLength).toBeLessThanOrEqual(
        BREADCRUMB_MAX_ENTRY_BYTES,
      );
    }

    const serialized = ring.readSerializedJson();
    expect(serialized.length).toBeLessThanOrEqual(BREADCRUMB_MAX_TOTAL_BYTES);
    expect(encoder.encode(serialized).byteLength).toBeLessThanOrEqual(BREADCRUMB_MAX_TOTAL_BYTES);
  });

  it('enforces <= 128 KiB total budget across max-size entries', () => {
    const ring = new DiagnosticsBreadcrumbs();
    const wide = `${'中'.repeat(290)}${'x'.repeat(19)}`; // ~1,023 B per entry -> 128 entries exceed 128 KiB

    for (let i = 0; i < 128; i += 1) {
      ring.record({
        category: 'unhandled_error',
        code: 'c12',
        name: null,
        message: `${i}:${wide}`,
      });
    }

    const json = ring.readSerializedJson();
    expect(json.length).toBeLessThanOrEqual(BREADCRUMB_MAX_TOTAL_BYTES);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(
      BREADCRUMB_MAX_TOTAL_BYTES,
    );
    const parsed = JSON.parse(json) as { droppedCount: number; entries: unknown[] };
    expect(parsed.entries.length).toBeLessThan(128);
    expect(parsed.droppedCount).toBeGreaterThan(0);

    const tighter = ring.readSerializedJson(4096);
    expect(tighter.length).toBeLessThanOrEqual(4096);
  });

  it('captures error before 80-char toast truncation and exposes window getter', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = installDiagnosticsCapture();
    try {
      const longMessage = `${'Detailed failure reason '.repeat(8)}tail-marker`;
      showErrorToast(new Error(longMessage));

      const raw = window.__atdReadDiagnosticsBreadcrumbsJson?.();
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!) as {
        entries: Array<{ category: string; message: string }>;
      };
      expect(parsed.entries.at(-1)?.category).toBe('unhandled_error');
      expect(parsed.entries.at(-1)?.message.length).toBeGreaterThan(80);
      expect(parsed.entries.at(-1)?.message.length).toBeLessThanOrEqual(320);

      // Bridge drop logging via console.error is captured without recording noisy channels.
      console.error('Dropped a message from the native shell:', new Error('Bad envelope'));
      console.error('A transcript.patch listener failed:', new Error('Should be ignored'));

      const after = JSON.parse(window.__atdReadDiagnosticsBreadcrumbsJson!()) as {
        entries: Array<{ category: string; message: string }>;
      };
      expect(after.entries.some((entry) => entry.category === 'bridge_drop')).toBe(true);
      expect(after.entries.some((entry) => entry.message.includes('Should be ignored'))).toBe(
        false,
      );
    } finally {
      dispose();
      spy.mockRestore();
    }
  });
});
