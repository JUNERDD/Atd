import { createHash } from 'node:crypto';

/**
 * Names of runner MCP proxies: `mcp__<server>__<tool>`, within the 64 characters providers accept.
 * Every proxy of one server shares the prefix `mcp__<server>__`; the prefix without its trailing
 * `__` is the server's tool namespace (pi's `ToolNamespace.name`), which `mcpProxyNamespace` reads
 * back from any proxy name.
 */

/** Providers reject tool names over 64 characters; pi's own MCP tools stay within it too. */
const MAX_NAME_LENGTH = 64;
/** A name over the limit ends in `_` and this many hex characters of a hash. */
const NAME_HASH_LENGTH = 8;
/** What such a name keeps of the original: 55 characters, so `<kept>_<hash>` is 64 long. */
const KEPT_NAME_LENGTH = MAX_NAME_LENGTH - NAME_HASH_LENGTH - 1;
/** Hex characters of the server id hash in a prefix that carries one. */
const ID_HASH_LENGTH = 10;
/** A server part that holds no `__` and neither starts nor ends in `_`. */
const SERVER_PART = '[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*';
const PLAIN_SERVER_PART = new RegExp(`^${SERVER_PART}$`);
const NAMESPACE = new RegExp(`^mcp__${SERVER_PART}(?=__)`);

/**
 * Proxy tool name: `mcp__<server>__<tool>`, sanitized for Pi and at most 64 characters. A longer
 * name keeps its first 55 characters and ends in `_` and 8 hex characters of SHA-256 over the raw
 * server id and tool name, as pi's `createMcpToolName` does, so tools that share their first 55
 * characters stay apart.
 *
 * `taken` holds the names other tools of the binding already have. Sanitizing can map `a.b` and
 * `a_b` to one name; the later tool then gets `_2`, `_3`, … after it. A numbered name that
 * outgrows the limit is shortened like any other, with the number in its hash, or every try would
 * shorten to the same name.
 */
export function mcpProxyName(
  serverId: string,
  tool: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const name = `${mcpProxyPrefix(serverId)}${cleanProxyPart(tool)}`;
  const seed = `${serverId}\0${tool}`;
  let candidate = fitProxyName(name, seed);
  for (let attempt = 2; taken.has(candidate); attempt += 1)
    candidate = fitProxyName(`${name}_${attempt}`, `${seed}\0${attempt}`);
  return candidate;
}

/** `name` when it fits the limit, else its first 55 characters, `_` and the hash of `seed`. */
function fitProxyName(name: string, seed: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, NAME_HASH_LENGTH);
  return `${name.slice(0, KEPT_NAME_LENGTH)}_${hash}`;
}

/**
 * The prefix every proxy of one server shares: `mcp__<server>__`. `references/material.ts` tells
 * the model to look for tools named `<prefix>*`, so it has to stay a true prefix of every proxy
 * name. A shortened name keeps only its first 55 characters (`fitProxyName`), so the prefix may
 * not run past 55 either: when the server id would take it further, the readable part is cut to
 * fit and a hash of the whole id follows it, so ids that share their start still get different
 * prefixes.
 *
 * The server part never holds `__` and never starts or ends in `_`, so the first `__` after
 * `mcp__` always ends it (`mcpProxyNamespace`). An id that cleans to anything else (`a__b`,
 * `_a`, `a-`) has its underscore runs collapsed and gets the hash, which keeps it apart from the
 * id it now reads like (`a_b`, `a`).
 *
 * A plugin server's qualified id (`<plugin>:<item>`) has characters the tool alphabet lacks, so
 * cleaning alone would give `kit:srv`, `kit.io:srv` and a user's `kit_srv` one prefix; it always
 * gets the readable part plus the hash, so its prefix names that server alone.
 */
export function mcpProxyPrefix(serverId: string): string {
  const readable = cleanProxyPart(serverId);
  const plain = `mcp__${readable}__`;
  if (
    !serverId.includes(':') &&
    PLAIN_SERVER_PART.test(readable) &&
    plain.length <= KEPT_NAME_LENGTH
  )
    return plain;
  const hash = createHash('sha256').update(serverId).digest('hex').slice(0, ID_HASH_LENGTH);
  const withHash = (part: string) => `mcp__${part}_${hash}__`;
  const room = KEPT_NAME_LENGTH - withHash('').length;
  const part = trimUnderscores(trimUnderscores(readable.replace(/_+/g, '_')).slice(0, room));
  return part ? withHash(part) : `mcp__${hash}__`;
}

/**
 * The tool namespace a proxy name belongs to: `mcp__<server>`, its prefix without the trailing
 * `__`; null for a name that is not a proxy's. Exact for names `mcpProxyPrefix` builds.
 */
export function mcpProxyNamespace(name: string): string | null {
  return NAMESPACE.exec(name)?.[0] ?? null;
}

/** Runs of characters outside the tool alphabet become one `_`; the callers bound the length. */
function cleanProxyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_') || 'x';
}

function trimUnderscores(value: string): string {
  return value.replace(/^_+|_+$/g, '');
}
