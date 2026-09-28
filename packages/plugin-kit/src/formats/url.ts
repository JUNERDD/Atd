/**
 * Minimal absolute-URL reader for MCP endpoints. The pure entry targets `lib: ES2023` without DOM
 * or Node types, so the WHATWG `URL` global is not available to it.
 */
export interface ParsedUrl {
  scheme: string;
  /** Lowercased host; IPv6 literals keep their brackets. */
  host: string;
  hasUserinfo: boolean;
  hasFragment: boolean;
}

const ABSOLUTE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)[^#]*(#.*)?$/;

export function parseAbsoluteUrl(value: string): ParsedUrl | null {
  if (/\s/.test(value)) return null;
  const match = ABSOLUTE.exec(value);
  const authority = match?.[2];
  if (!match?.[1] || authority === undefined) return null;
  const at = authority.lastIndexOf('@');
  const hostPort = authority.slice(at + 1);
  let host: string;
  let port: string;
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close === -1) return null;
    host = hostPort.slice(0, close + 1);
    port = hostPort.slice(close + 1);
  } else {
    const colon = hostPort.indexOf(':');
    host = colon === -1 ? hostPort : hostPort.slice(0, colon);
    port = colon === -1 ? '' : hostPort.slice(colon);
  }
  if (host === '' || (port !== '' && !/^:\d{1,5}$/.test(port))) return null;
  return {
    scheme: match[1].toLowerCase(),
    host: host.toLowerCase(),
    hasUserinfo: at !== -1,
    hasFragment: match[3] !== undefined,
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
