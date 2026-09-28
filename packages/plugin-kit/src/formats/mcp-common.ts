import type { McpTransport } from '../model/manifest.js';
import { addComponent, itemName, report, type AdapterContext } from './context.js';

/** Why a server entry was not normalized; the adapter reports it and skips the server. */
export type ServerProblem =
  | { code: 'invalid-component' | 'unsupported-transport'; message: string }
  | { code: 'path-escape'; message: string };

export type ServerResult =
  | { ok: true; transport: McpTransport }
  | { ok: false; problem: ServerProblem };

export function invalid(message: string): ServerResult {
  return { ok: false, problem: { code: 'invalid-component', message } };
}

export function unsupported(message: string): ServerResult {
  return { ok: false, problem: { code: 'unsupported-transport', message } };
}

/** Checks the model's size limits so a normalized transport always validates. */
export function transportTooLarge(transport: McpTransport): boolean {
  const values = transport.type === 'stdio' ? transport.env : transport.headers;
  if (Object.values(values).some((value) => value.length > 8192)) return true;
  if (transport.type === 'http') return transport.url.length > 2048;
  return (
    transport.command.length > 4096 ||
    transport.args.length > 256 ||
    transport.args.some((arg) => arg.length > 8192) ||
    (transport.cwd?.length ?? 0) > 4096
  );
}

/** Reports a skipped server with the problem's own code. */
export function reportServer(
  ctx: AdapterContext,
  rawName: string,
  path: string,
  problem: ServerProblem,
): void {
  report(ctx, 'warning', problem.code, `MCP server "${rawName}": ${problem.message}`, {
    path,
    component: { kind: 'mcp', name: rawName.slice(0, 256) },
  });
}

/**
 * Normalizes a server name and adds the component, or reports why the server is skipped.
 * Returns the item name when the server was accepted.
 */
export function acceptServer(
  ctx: AdapterContext,
  rawName: string,
  path: string,
  result: ServerResult,
): string | null {
  if (!result.ok) {
    reportServer(ctx, rawName, path, result.problem);
    return null;
  }
  if (transportTooLarge(result.transport)) {
    reportServer(ctx, rawName, path, {
      code: 'invalid-component',
      message: 'a value exceeds the supported size.',
    });
    return null;
  }
  const name = itemName(ctx, 'mcp', rawName, path);
  if (name === null) return null;
  addComponent(ctx, { kind: 'mcp', name, transport: result.transport, source: path }, path);
  return name;
}
