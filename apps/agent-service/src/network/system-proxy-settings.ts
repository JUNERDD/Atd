import { BlockList, isIP } from 'node:net';
import { parse } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';

const SystemProxySchema = Type.Object(
  {
    http: Type.Optional(Type.String({ minLength: 1 })),
    https: Type.Optional(Type.String({ minLength: 1 })),
    exceptions: Type.Array(Type.String()),
    excludeSimpleHostnames: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type SystemProxySettings = Static<typeof SystemProxySchema>;

/** The native shell supplies only HTTP CONNECT proxy endpoints, never account credentials. */
export function readSystemProxySettings(raw: unknown): SystemProxySettings {
  const settings = parse(SystemProxySchema, raw);
  for (const endpoint of [settings.http, settings.https]) {
    if (!endpoint) continue;
    const url = new URL(endpoint);
    if (
      url.protocol !== 'http:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid system HTTP proxy endpoint.');
  }
  return settings;
}

/** Proxy URI for a request, or undefined to connect directly. */
export type SystemProxyResolver = (protocol: string, hostname: string) => string | undefined;

/**
 * Preserve macOS exceptions (including FlClash's IP-prefix wildcards) for both HTTP stacks.
 * Like CFNetwork, an entry that cannot be applied is skipped rather than abandoning the proxy;
 * `skipped` counts them for the configuration log.
 */
export function systemProxyResolver(settings: SystemProxySettings): {
  resolve: SystemProxyResolver;
  skipped: number;
} {
  const subnets = new BlockList();
  subnets.addSubnet('127.0.0.0', 8);
  subnets.addAddress('::1', 'ipv6');
  const patterns: RegExp[] = [];
  let skipped = 0;
  for (const entry of settings.exceptions) {
    const rule = entry.trim().toLowerCase().replace(/\.$/, '');
    if (!rule) continue;
    if (rule.includes('/')) {
      const subnet = bypassSubnet(rule);
      if (subnet) subnets.addSubnet(subnet.address, subnet.bits, subnet.family);
      else skipped += 1;
    } else if (
      rule === '*' ||
      rule.split('.').some((label) => label.includes('*') && label !== '*')
    ) {
      // macOS accepts whole-label wildcards, not shell globs such as "172.2*" or "*example.com".
      skipped += 1;
    } else {
      const expression = (rule.startsWith('.') ? `*${rule}` : rule)
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      patterns.push(new RegExp(`^${expression}$`, 'i'));
    }
  }
  const resolve: SystemProxyResolver = (protocol, hostname) => {
    const host = hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
    const family = isIP(host);
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      (family !== 0 && subnets.check(host, family === 4 ? 'ipv4' : 'ipv6')) ||
      (settings.excludeSimpleHostnames && !family && !host.includes('.')) ||
      patterns.some((pattern) => pattern.test(host))
    )
      return undefined;
    if (protocol === 'http:') return settings.http;
    if (protocol === 'https:') return settings.https;
    return undefined;
  };
  return { resolve, skipped };
}

/** A CIDR bypass entry; macOS also accepts abbreviated IPv4 networks such as 169.254/16 and 10/8. */
function bypassSubnet(rule: string) {
  const [network = '', prefix = '', extra] = rule.split('/');
  const address = /^\d+(?:\.\d+){0,2}$/.test(network)
    ? network + '.0'.repeat(4 - network.split('.').length)
    : network;
  const family = isIP(address);
  const bits = Number(prefix);
  if (!family || !/^\d+$/.test(prefix) || extra !== undefined || bits > (family === 4 ? 32 : 128))
    return undefined;
  return { address, bits, family: family === 4 ? ('ipv4' as const) : ('ipv6' as const) };
}
