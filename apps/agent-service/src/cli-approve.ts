import { createInterface } from 'node:readline/promises';
import {
  ErrorEnvelopeSchema,
  McpLaunchApprovalDetailsSchema,
  McpLaunchApproveResponseSchema,
  parse,
  type McpLaunchApprovalDetails,
  type McpLaunchApproveRequest,
} from '@ai/agent-contracts';
import { readEndpoint, readLocalToken } from './config.js';

/**
 * `agent-service approve mcp <serverId>`: the terminal counterpart of the shell's native
 * confirmation. It asks the running service (main token, shell-only routes) for what approving
 * would allow, shows it, and approves only after a `y` typed on a terminal, or with `--yes`. The
 * service recomputes the fingerprint, so a server that changes in between is refused.
 */
export async function approveMcp(
  dataDir: string,
  serverId: string,
  options: { yes: boolean },
): Promise<void> {
  if (!options.yes && !process.stdin.isTTY)
    throw new Error('Approval needs a terminal to confirm on; pass --yes to approve without one.');
  const endpoint = await readEndpoint(dataDir);
  if (!endpoint) throw new Error(`No endpoint metadata in ${dataDir}; is the service running?`);
  const token = await readLocalToken(dataDir);
  if (!token) throw new Error('Local service token is missing.');
  const base = `${endpoint.url}/v1/admin/approvals/mcp`;
  const details = parse(
    McpLaunchApprovalDetailsSchema,
    await call(`${base}/${encodeURIComponent(serverId)}`, token),
  );
  process.stdout.write(describe(details));
  if (details.state === 'approved') {
    process.stdout.write('It is already approved as it stands.\n');
    return;
  }
  if (!options.yes && !(await confirm(`Allow ${JSON.stringify(serverId)} to launch? [y/N] `))) {
    process.stdout.write('Not approved.\n');
    process.exitCode = 1;
    return;
  }
  const body: McpLaunchApproveRequest = {
    serverId,
    fingerprint: details.fingerprint,
    via: 'cli',
  };
  const { approval } = parse(McpLaunchApproveResponseSchema, await call(base, token, body));
  process.stdout.write(`Approved ${JSON.stringify(serverId)} at ${approval.approvedAt}.\n`);
}

async function call(url: string, token: string, body?: McpLaunchApproveRequest): Promise<unknown> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return json;
  let message = `The service answered HTTP ${response.status}.`;
  try {
    const { error } = parse(ErrorEnvelopeSchema, json);
    message = `${error.message} (${error.code})`;
  } catch {
    // Not an error envelope: the status line says enough.
  }
  throw new Error(message);
}

async function confirm(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes)$/i.test((await terminal.question(question)).trim());
  } finally {
    terminal.close();
  }
}

/**
 * The details as terminal lines. Every value that came from a server's configuration is printed
 * JSON-quoted, so control characters and escape sequences in it cannot redraw the prompt.
 */
function describe(details: McpLaunchApprovalDetails): string {
  const q = (value: string) => JSON.stringify(value);
  const lines = [
    `MCP server ${q(details.serverId)} (${details.layer}, ${details.kind}): ${details.state}`,
  ];
  if (details.plugin) {
    const { name, version, source, revision } = details.plugin;
    lines.push(`  Plugin: ${q(name)}${version ? ` ${q(version)}` : ''} from ${q(source)}`);
    lines.push(`  Plugin revision: ${revision}`);
  }
  if (details.stdio) {
    const { command, resolvedCommand, args, cwd, inheritEnv, env } = details.stdio;
    lines.push(`  Command: ${q(command)}`, `  Runs: ${q(resolvedCommand)}`);
    lines.push(`  Arguments: ${JSON.stringify(args)}`, `  Working directory: ${q(cwd)}`);
    lines.push(`  Inherits the service environment: ${inheritEnv ? 'yes' : 'no'}`);
    for (const entry of env)
      lines.push(
        `  Env ${q(entry.key)}: ${entry.length} characters${entry.risky ? ' (changes what the runtime loads)' : ''}`,
      );
  }
  if (details.http) {
    lines.push(`  URL: ${q(details.http.url)}`);
    lines.push(`  Bearer token from service env var: ${q(details.http.tokenEnv)}`);
    if (details.http.headerKeys.length)
      lines.push(`  Header names: ${JSON.stringify(details.http.headerKeys)}`);
  }
  return `${lines.join('\n')}\n`;
}
