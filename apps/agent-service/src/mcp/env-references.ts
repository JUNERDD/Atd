/**
 * The service environment references pi-mcp-adapter fills in when it dials an HTTP server, and the
 * one place that knows their syntax. The adapter (utils.ts `interpolateEnvVars`, 3.1.0) replaces
 * `${NAME}`, then `$env:NAME`, then `{env:NAME}`, NAME being `\w+`, in the server URL and in every
 * header value (a `!!` escape included) with the service process's own environment, whether or not
 * the variable is set. Anything else, such as a lone `$` or `${a-b}`, is sent literally.
 *
 * Plugin HTTP transports reach this form too: plugin-kit leaves their `${VAR}` references for the
 * adapter instead of substituting values (plugin-kit `substituteTransport`).
 */

const REFERENCES = [/\$\{(\w+)\}/g, /\$env:(\w+)/g, /\{env:(\w+)\}/g] as const;

/** The env var names the adapter reads for `text`, sorted and unique. */
export function envReferences(text: string): string[] {
  const names = new Set<string>();
  for (const pattern of REFERENCES)
    for (const [, name] of text.matchAll(pattern)) if (name) names.add(name);
  return [...names].sort();
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
