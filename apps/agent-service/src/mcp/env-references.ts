/**
 * The service environment references the service fills in when it launches or dials an MCP
 * server, and the one place that knows their syntax. `${NAME}`, then `$env:NAME`, then
 * `{env:NAME}` (NAME being `\w+`) are replaced in a stdio server's arguments, env values and
 * working directory and in an HTTP server's URL and header values (a `!!` escape included) with
 * the service process's own environment, whether or not the variable is set. Anything else, such
 * as a lone `$` or `${a-b}`, stays literal. These are the rules pi-mcp-adapter applied before the
 * service resolved them itself, so records written for it keep their meaning.
 *
 * Plugin HTTP transports reach this form too: plugin-kit leaves their `${VAR}` references for the
 * service instead of substituting values (plugin-kit `substituteTransport`).
 */

const REFERENCES = [/\$\{(\w+)\}/g, /\$env:(\w+)/g, /\{env:(\w+)\}/g] as const;

/** The env var names `text` reads, sorted and unique. */
export function envReferences(text: string): string[] {
  const names = new Set<string>();
  for (const pattern of REFERENCES)
    for (const [, name] of text.matchAll(pattern)) if (name) names.add(name);
  return [...names].sort();
}

type Environment = Readonly<Record<string, string | undefined>>;

/** An own variable's value: `constructor` is not a variable just because objects have one. */
function variable(env: Environment, name: string): string | undefined {
  return Object.hasOwn(env, name) ? env[name] : undefined;
}

/**
 * Fills `${NAME}`, then `$env:NAME`, then `{env:NAME}`; an unset name becomes ''. The passes run in
 * that order over the text as the previous pass left it, so a value that itself holds a later
 * syntax is filled again, exactly as the adapter did.
 */
export function interpolateEnvReferences(text: string, env: Environment): string {
  let filled = text;
  for (const pattern of REFERENCES)
    filled = filled.replace(pattern, (_match, name: string) => variable(env, name) ?? '');
  return filled;
}

/** Names `text` reads that `env` leaves undefined (an empty value counts as set), sorted. */
export function unsetEnvReferences(text: string, env: Environment): string[] {
  return envReferences(text).filter((name) => variable(env, name) === undefined);
}

/** Where an HTTP server's URL and headers read the service environment. */
export interface HttpEnvReads {
  /** Names the URL reads. */
  url: string[];
  /** Names each header value reads, by header name. */
  headers: Map<string, string[]>;
  /** Every name the URL and headers read, sorted and unique. */
  names: string[];
}

export function httpEnvReads(url: string, headers: Readonly<Record<string, string>>): HttpEnvReads {
  const byHeader = new Map(
    Object.entries(headers).map(([key, value]) => [key, envReferences(value)] as const),
  );
  const urlNames = envReferences(url);
  const names = new Set([...urlNames, ...[...byHeader.values()].flat()]);
  return { url: urlNames, headers: byHeader, names: [...names].sort() };
}
