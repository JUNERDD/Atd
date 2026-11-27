import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Api, ClientAttribution, ClientIdentity, Provider } from '@earendil-works/pi-ai';
import { readServiceManifest } from '../node-runtime.js';

const ATD_ATTRIBUTION: ClientAttribution = {
  name: 'Atd',
  url: 'https://atd.best',
};

const VERSION_TOKEN = /^[0-9A-Za-z._-]+$/;
const DEFAULT_SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cachedUserAgent: string | undefined;

function validVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return VERSION_TOKEN.test(trimmed) ? trimmed : undefined;
}

function readBundleVersion(serviceRoot: string): string | undefined {
  try {
    const plist = readFileSync(path.resolve(serviceRoot, '../../Info.plist'), 'utf8');
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
    return validVersion(match?.[1]);
  } catch {
    return undefined;
  }
}

function readWorkspaceAppVersion(serviceRoot: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(path.resolve(serviceRoot, '../desktop/package.json'), 'utf8'),
    );
    return raw && typeof raw === 'object' ? validVersion(Reflect.get(raw, 'version')) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Atd's marketing version: packaged `Contents/Info.plist` first, then the workspace
 * desktop manifest, falling back to the service package manifest.
 */
export function atdAppVersion(serviceRoot = DEFAULT_SERVICE_ROOT): string {
  return (
    readBundleVersion(serviceRoot) ??
    readWorkspaceAppVersion(serviceRoot) ??
    readServiceManifest(path.join(serviceRoot, 'dist')).version
  );
}

/** Truthful Atd User-Agent matching Pi's detailed format without impersonating `pi`. */
export function atdUserAgent(): string {
  if (!cachedUserAgent) {
    cachedUserAgent = `Atd/${atdAppVersion()} (${process.platform}; node/${process.versions.node}; ${process.arch})`;
  }
  return cachedUserAgent;
}

/** Provider client identity applied to every outbound model request made by Atd. */
export function atdClientIdentity(): ClientIdentity {
  return {
    userAgent: { custom: atdUserAgent() },
    attribution: ATD_ATTRIBUTION,
  };
}

/**
 * Pin Atd's identity at the provider boundary so AgentSession's built-in `pi` identity and
 * unattributed direct `ModelRuntime` calls both identify as Atd.
 */
export function withAtdIdentity(base: Provider): Provider {
  const fetchDeferred = base.fetchDeferred?.bind(base);
  const cancelDeferred = base.cancelDeferred?.bind(base);
  const generateImages = base.generateImages?.bind(base);
  const classify = base.classify?.bind(base);
  return {
    ...base,
    stream: (model, context, options) =>
      base.stream<Api>(model, context, { ...options, identity: atdClientIdentity() }),
    streamSimple: (model, context, options) =>
      base.streamSimple(model, context, { ...options, identity: atdClientIdentity() }),
    ...(fetchDeferred
      ? {
          fetchDeferred: (model, handle, options) =>
            fetchDeferred(model, handle, { ...options, identity: atdClientIdentity() }),
        }
      : {}),
    ...(cancelDeferred
      ? {
          cancelDeferred: (model, handle, options) =>
            cancelDeferred(model, handle, { ...options, identity: atdClientIdentity() }),
        }
      : {}),
    ...(generateImages
      ? {
          generateImages: (model, context, options) =>
            generateImages(model, context, { ...options, identity: atdClientIdentity() }),
        }
      : {}),
    ...(classify
      ? {
          classify: (model, context, options) =>
            classify(model, context, { ...options, identity: atdClientIdentity() }),
        }
      : {}),
  };
}
