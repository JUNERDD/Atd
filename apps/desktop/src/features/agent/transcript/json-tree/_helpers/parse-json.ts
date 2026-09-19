export type SafeParseResult = { ok: true; value: unknown } | { ok: false };

/** Runtime boundary for tool JSON: blank text and malformed payloads degrade, never throw. */
export function safeParseJson(text: string): SafeParseResult {
  if (text.trim() === '') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
