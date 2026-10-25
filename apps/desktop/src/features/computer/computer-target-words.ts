import type { TargetBinding } from '@atd/agent-contracts';

/** An origin as people read it: the host and port, without the scheme. */
export function originHost(origin: string): string {
  return origin.replace(/^https?:\/\//, '');
}

/**
 * The kinds of target a person adds and reads: a browser environment, or an application (a
 * native binding).
 */
export type TargetKind = 'browser' | 'application';

export function targetKind(binding: TargetBinding): TargetKind {
  return binding.kind === 'browser' ? 'browser' : 'application';
}

/**
 * The line under a target's name: a browser environment's allowed sites or an application's name.
 * Runtime values, never translated.
 */
export function targetDetail(binding: TargetBinding): string {
  return binding.kind === 'browser'
    ? binding.allowedOrigins.map(originHost).join(', ')
    : binding.appName;
}

/** An http(s) URL from what a person typed: a full URL, or one without a scheme (https). */
function webUrl(text: string): URL | null {
  const value = text.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The origin of a typed site, as `scheme://host[:port]`. */
export function toOrigin(text: string): string | null {
  return webUrl(text)?.origin ?? null;
}

/** A start page as the browser environment opens it. */
export function toStartUrl(text: string): string | null {
  return webUrl(text)?.href ?? null;
}

/**
 * The allowed sites a browser environment's field lists, one per line or comma, as origins in
 * the order given; `invalid` names the first entry that is not a site.
 */
export function readOrigins(text: string): { origins: string[] } | { invalid: string } {
  const origins: string[] = [];
  for (const entry of text.split(/[\n,]/).map((item) => item.trim())) {
    if (!entry) continue;
    const origin = toOrigin(entry);
    if (!origin) return { invalid: entry };
    if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins };
}
