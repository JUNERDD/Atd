import { isElementRole, type ElementRole } from './text.js';

/**
 * Parses Playwright's documented `ariaSnapshot()` YAML (default mode) into the elements the
 * worker lists: one line per node, `- role "name" [attr] [attr=value]: value`. Lines of other
 * roles (text, generic, headings, `/url:` properties) are skipped. The YAML is data from the
 * page, so every piece is matched, never trusted.
 */

export interface SnapshotElement {
  role: ElementRole;
  name: string;
  value: string | undefined;
  disabled: boolean;
}

const LINE = /^\s*- ([a-z]+)(?: ("(?:[^"\\]|\\.)*"))?((?: \[[^\]]*\])*)(?::(?: (.*))?)?$/;

/** A double-quoted YAML scalar's text. */
function unquote(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : text;
  } catch {
    return text.slice(1, -1);
  }
}

export function parseSnapshot(yaml: string): SnapshotElement[] {
  const elements: SnapshotElement[] = [];
  for (const line of yaml.split('\n')) {
    const match = LINE.exec(line);
    if (match === null) continue;
    const role = match[1] ?? '';
    if (!isElementRole(role)) continue;
    const name = match[2] === undefined ? '' : unquote(match[2]);
    const attributes = match[3] ?? '';
    const raw = match[4];
    const value =
      raw === undefined || raw === '' ? undefined : raw.startsWith('"') ? unquote(raw) : raw;
    elements.push({ role, name, value, disabled: attributes.includes('[disabled]') });
  }
  return elements;
}
