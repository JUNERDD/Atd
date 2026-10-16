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

type SystemProxySettings = Static<typeof SystemProxySchema>;

/** The native shell supplies only HTTP CONNECT proxy endpoints, never account credentials. */
export function readSystemProxySettings(raw: string): SystemProxySettings {
  const settings = parse(SystemProxySchema, JSON.parse(raw));
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

/** Preserve macOS exceptions (including FlClash's IP-prefix wildcards) for both HTTP stacks. */
export function systemProxyResolver(settings: SystemProxySettings) {
  const subnets = new BlockList();
  subnets.addSubnet('127.0.0.0', 8);
  subnets.addAddress('::1', 'ipv6');
  const patterns: RegExp[] = [];
  for (const entry of settings.exceptions) {
    const rule = entry.trim().toLowerCase().replace(/\.$/, '');
    if (!rule) continue;
    if (rule.includes('/')) {
      const [network = '', prefix, extra] = rule.split('/');
      // macOS accepts abbreviated IPv4 networks such as 169.254/16 and 10/8.
      const address = /^\d+(?:\.\d+){0,2}$/.test(network)
        ? network + '.0'.repeat(4 - network.split('.').length)
        : network;
      const family = isIP(address ?? '');
      const bits = Number(prefix);
      if (
        !address ||
        !family ||
        !/^\d+$/.test(prefix ?? '') ||
        extra !== undefined ||
        bits > (family === 4 ? 32 : 128)
      )
        throw new Error('Invalid system proxy bypass subnet.');
      subnets.addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6');
    } else {
      // macOS accepts whole-label wildcards, not shell globs such as "172.2*" or "*example.com".
      if (rule === '*' || rule.split('.').some((label) => label.includes('*') && label !== '*'))
        continue;
      const expression = (rule.startsWith('.') ? `*${rule}` : rule)
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      patterns.push(new RegExp(`^${expression}$`, 'i'));
    }
  }
  return (protocol: string, hostname: string): string | undefined => {
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
}

export type SystemProxyResolver = ReturnType<typeof systemProxyResolver>;
