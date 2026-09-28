import type { PluginDiagnostic } from '../model/diagnostics.js';
import type { ComponentKind, PluginComponent } from '../model/manifest.js';
import { toItemName, toPluginName } from '../model/names.js';
import { PathEscapeError, type FsEntry, type ReadonlyFs } from '../ports.js';
import { invalidManifest } from './errors.js';
import { displayPath } from './paths.js';

/**
 * Per-bundle adapter state. Adapters read only through these helpers so every filesystem problem
 * becomes a diagnostic on the affected component instead of an exception.
 */
export interface AdapterContext {
  fs: ReadonlyFs;
  diagnostics: PluginDiagnostic[];
  components: PluginComponent[];
  /** Names taken per kind; the first component with a name wins. */
  taken: Map<ComponentKind, Set<string>>;
}

export function createContext(fs: ReadonlyFs): AdapterContext {
  return { fs, diagnostics: [], components: [], taken: new Map() };
}

export interface DiagnosticTarget {
  path?: string;
  component?: { kind: string; name: string };
}

/** Records a diagnostic once; identical repeats (same code, path and message) are dropped. */
export function report(
  ctx: AdapterContext,
  level: PluginDiagnostic['level'],
  code: PluginDiagnostic['code'],
  message: string,
  target: DiagnosticTarget = {},
): void {
  const path = target.path === undefined ? undefined : displayPath(target.path);
  const repeated = ctx.diagnostics.some(
    (existing) => existing.code === code && existing.path === path && existing.message === message,
  );
  if (repeated) return;
  const diagnostic: PluginDiagnostic = { level, code, message: message.slice(0, 2000) };
  if (path !== undefined) diagnostic.path = path;
  if (target.component) diagnostic.component = target.component;
  ctx.diagnostics.push(diagnostic);
}

/** Reports a path outside the root; the caller skips whatever referenced it. */
export function reportEscape(ctx: AdapterContext, path: string): void {
  report(ctx, 'warning', 'path-escape', `Path "${path}" resolves outside the plugin root.`, {
    path,
  });
}

function reportFsError(ctx: AdapterContext, path: string, error: unknown): void {
  if (error instanceof PathEscapeError) {
    reportEscape(ctx, path);
    return;
  }
  const reason = error instanceof Error ? error.message : String(error);
  report(ctx, 'warning', 'invalid-component', `Could not read "${path}": ${reason}`, { path });
}

export async function statPath(ctx: AdapterContext, path: string): Promise<FsEntry['kind'] | null> {
  try {
    return await ctx.fs.stat(path);
  } catch (error) {
    reportFsError(ctx, path, error);
    return null;
  }
}

/** Directory entries sorted by name, so scan order (and duplicate resolution) is stable. */
export async function listDir(ctx: AdapterContext, path: string): Promise<FsEntry[]> {
  try {
    const entries = await ctx.fs.list(path);
    return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (error) {
    reportFsError(ctx, path, error);
    return [];
  }
}

export async function readText(ctx: AdapterContext, path: string): Promise<string | null> {
  try {
    return await ctx.fs.readText(path);
  } catch (error) {
    reportFsError(ctx, path, error);
    return null;
  }
}

/** Parses JSON text; returns undefined after reporting `invalid-component` when it fails. */
export function parseJson(ctx: AdapterContext, path: string, text: string): unknown {
  try {
    return JSON.parse(stripBom(text)) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    report(ctx, 'warning', 'invalid-component', `"${path}" is not valid JSON: ${reason}`, {
      path,
    });
    return undefined;
  }
}

export async function readJson(ctx: AdapterContext, path: string): Promise<unknown> {
  const text = await readText(ctx, path);
  return text === null ? undefined : parseJson(ctx, path, text);
}

/**
 * Normalizes a raw item name. `raw` may be a nested path (`db/migrate`); flattening its `/` to `-`
 * is expected and not reported, any other change is reported as `renamed`.
 */
export function itemName(
  ctx: AdapterContext,
  kind: ComponentKind,
  raw: string,
  path: string,
): string | null {
  const flattened = raw.split('/').join('-');
  const name = toItemName(flattened);
  if (name === null) {
    report(ctx, 'warning', 'invalid-component', `${kind} name "${raw}" has no usable characters.`, {
      path,
    });
    return null;
  }
  if (name !== flattened) {
    report(ctx, 'info', 'renamed', `${kind} "${raw}" is loaded as "${name}".`, {
      path,
      component: { kind, name },
    });
  }
  return name;
}

/** Whether a component of `kind` already uses `name`. */
export function isTaken(ctx: AdapterContext, kind: ComponentKind, name: string): boolean {
  return ctx.taken.get(kind)?.has(name) ?? false;
}

/** Adds a component unless its name is taken for its kind (then reports `duplicate`). */
export function addComponent(ctx: AdapterContext, component: PluginComponent, path: string): void {
  const names = ctx.taken.get(component.kind) ?? new Set<string>();
  ctx.taken.set(component.kind, names);
  if (names.has(component.name)) {
    report(
      ctx,
      'warning',
      'duplicate',
      `Another ${component.kind} is already named "${component.name}"; "${displayPath(path)}" is skipped.`,
      { path, component: { kind: component.kind, name: component.name } },
    );
    return;
  }
  names.add(component.name);
  ctx.components.push(component);
}

/** Drops a leading byte-order mark, which JSON.parse and YAML fences do not accept. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An array of strings, or null when `value` is anything else. */
export function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : null;
}

/** A record of string values, or null when any value is not a string. */
export function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, entry]) => typeof entry === 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Resolves a plugin name. A name read from a manifest at `path` reports `renamed` when
 * normalization changed it; a fallback (directory) name is normalized silently.
 */
export function pluginName(ctx: AdapterContext, raw: string, path?: string): string {
  const name = toPluginName(raw);
  if (name === null) {
    throw invalidManifest(`"${raw}" cannot be turned into a valid plugin name.`, path);
  }
  if (name !== raw && path !== undefined) {
    report(ctx, 'info', 'renamed', `Plugin "${raw}" is loaded as "${name}".`, { path });
  }
  return name;
}

/** Reports Claude `` !`cmd` `` / ```` ```! ```` blocks, which are kept as text. */
export function reportShell(ctx: AdapterContext, path: string, kind: string, name: string): void {
  report(
    ctx,
    'warning',
    'shell-injection',
    `${kind} "${name}" contains shell command blocks; they are kept as text and never run.`,
    { path, component: { kind, name } },
  );
}
