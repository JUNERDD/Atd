/**
 * Returns whether `raw` is a complete top-level JSON object literal (balanced braces and brackets
 * outside string literals, with no trailing tokens after the closing brace).
 */
export function isClosedJsonObject(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (depth < 0) return false;
    if (depth === 0 && i < trimmed.length - 1) return false;
  }
  return !inString && depth === 0;
}

/**
 * Whether a `toolCall` content part is still streaming its JSON arguments. Earlier parts in a
 * multi-call message have `partStreaming === false`, and a part whose `partialArgs` or
 * `partialJson` is already a closed top-level JSON object has finished streaming.
 */
export function isToolCallStreaming(part: unknown, partStreaming: boolean): boolean {
  if (!partStreaming) return false;
  if (!part || typeof part !== 'object') return true;
  const record = part as Record<string, unknown>;
  const raw =
    typeof record.partialArgs === 'string'
      ? record.partialArgs
      : typeof record.partialJson === 'string'
        ? record.partialJson
        : null;
  if (raw === null) return true;
  return !isClosedJsonObject(raw);
}
