import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  errorMessage,
  parse,
  PROTOCOL_VERSION,
  ServiceTokenFileSchema,
  type ServiceTokenFile,
} from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import {
  acquireDataDirLock,
  getConfigRecoveryState,
  isCorruptConfigError,
  isErrnoCode,
  isLockHolderAlive,
  noteConfigRecovery,
  releaseDataDirLock,
  resetConfigRecoveryStateForTests,
  type ConfigRecoveryState,
} from './config-lock.js';
import { scrubPersonalPaths } from './diagnostics/scrub-paths.js';
import { resolveDataDir, servicePaths, type ServicePaths } from './storage.js';

export {
  getConfigRecoveryState,
  isLockHolderAlive,
  resetConfigRecoveryStateForTests,
  type ConfigRecoveryState,
};

const ServiceFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    serviceId: Type.String({ minLength: 1, maxLength: 128 }),
    protocolVersion: Type.String({ maxLength: 16 }),
    epoch: Type.Integer({ minimum: 0 }),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
type ServiceFile = Static<typeof ServiceFileSchema>;

const EndpointFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    serviceId: Type.String({ minLength: 1, maxLength: 128 }),
    protocolVersion: Type.String({ maxLength: 16 }),
    epoch: Type.Integer({ minimum: 0 }),
    host: Type.String({ maxLength: 256 }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    url: Type.String({ maxLength: 2048 }),
    pid: Type.Integer({ minimum: 1 }),
    startedAt: Type.String(),
    /** Identity of a packaged build (see readBuildId); development builds omit it. */
    buildId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type EndpointFile = Static<typeof EndpointFileSchema>;

const BuildInfoSchema = Type.Object(
  { version: Type.Literal(1), buildId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);

export interface ServiceConfig {
  paths: ServicePaths;
  serviceId: string;
  epoch: number;
  token: string;
  host: string;
  port: number;
}

/** Acquires the dataDir owner lock; recovers corrupt/stale locks and throws when a live owner holds it. */
export function acquireLock(paths: ServicePaths): Promise<void> {
  return acquireDataDirLock(paths, atomicWrite);
}

export function releaseLock(paths: ServicePaths): Promise<void> {
  return releaseDataDirLock(paths);
}

/**
 * Writes `text` to `file` so a reader sees the old file or the whole new one, never a torn one:
 * a temporary sibling is written and synced, then renamed over the target.
 */
export async function writeTextAtomic(file: string, text: string, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', mode);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** `writeTextAtomic` for a JSON value. */
export async function atomicWrite(file: string, value: unknown, mode = 0o600): Promise<void> {
  await writeTextAtomic(file, JSON.stringify(value), mode);
}

async function createServiceFile(paths: ServicePaths): Promise<ServiceFile> {
  const created: ServiceFile = {
    version: 1,
    serviceId: randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    epoch: 0,
    createdAt: new Date().toISOString(),
  };
  await atomicWrite(paths.serviceFile, created);
  return created;
}

async function loadServiceFile(paths: ServicePaths): Promise<ServiceFile> {
  try {
    return parse(ServiceFileSchema, JSON.parse(await readFile(paths.serviceFile, 'utf8')));
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return createServiceFile(paths);
    if (isCorruptConfigError(error)) {
      noteConfigRecovery('serviceFileRecreated');
      return createServiceFile(paths);
    }
    throw new Error(
      `Service identity could not be read: ${scrubPersonalPaths(errorMessage(error))}`,
    );
  }
}

async function writeNewToken(paths: ServicePaths, serviceId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const file: ServiceTokenFile = {
    version: 1,
    serviceId,
    token,
    createdAt: new Date().toISOString(),
  };
  await atomicWrite(paths.tokenFile, file, 0o600);
  return token;
}

async function loadToken(paths: ServicePaths, serviceId: string): Promise<string> {
  try {
    const file: ServiceTokenFile = parse(
      ServiceTokenFileSchema,
      JSON.parse(await readFile(paths.tokenFile, 'utf8')),
    );
    if (file.serviceId === serviceId) return file.token;
    noteConfigRecovery('tokenRotated');
    return writeNewToken(paths, serviceId);
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return writeNewToken(paths, serviceId);
    if (isCorruptConfigError(error)) {
      noteConfigRecovery('tokenRotated');
      return writeNewToken(paths, serviceId);
    }
    throw error;
  }
}

/**
 * Prepares dataDir ownership for `serve`: resolves the dir, locks it, bumps
 * the epoch and loads the bearer token. Callers must release the lock on exit.
 */
export async function prepareServe(options: {
  envDir?: string | undefined;
  flagDir?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
}): Promise<ServiceConfig> {
  const root = resolveDataDir(options);
  const paths = servicePaths(root);
  await acquireLock(paths);
  try {
    const service = await loadServiceFile(paths);
    const epoch = service.epoch + 1;
    await atomicWrite(paths.serviceFile, { ...service, epoch, protocolVersion: PROTOCOL_VERSION });
    const token = await loadToken(paths, service.serviceId);
    return {
      paths,
      serviceId: service.serviceId,
      epoch,
      token,
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 0,
    };
  } catch (error) {
    await releaseLock(paths).catch(() => undefined);
    throw error;
  }
}

/** Reads live endpoint metadata for `status`/`stop` without taking ownership. */
export async function readEndpoint(dataDir: string): Promise<EndpointFile | null> {
  try {
    const paths = servicePaths(path.resolve(dataDir));
    return parse(EndpointFileSchema, JSON.parse(await readFile(paths.endpointFile, 'utf8')));
  } catch {
    return null;
  }
}

/** Reads the local bearer token for `status`/`stop` on the same machine. */
export async function readLocalToken(dataDir: string): Promise<string | null> {
  try {
    const paths = servicePaths(path.resolve(dataDir));
    return parse(ServiceTokenFileSchema, JSON.parse(await readFile(paths.tokenFile, 'utf8'))).token;
  } catch {
    return null;
  }
}

/**
 * The packaged build's identity, read from `build-info.json` in the service package root, which
 * the desktop pack step writes. The desktop app reuses a running service only when the buildId in
 * its endpoint matches the one it ships. Development builds have no such file and return undefined; a file
 * that exists but does not parse throws, so a broken pack never passes as a development build.
 */
export async function readBuildId(
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(path.join(packageRoot, 'build-info.json'), 'utf8');
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  return parse(BuildInfoSchema, JSON.parse(text)).buildId;
}

export async function writeEndpoint(
  paths: ServicePaths,
  endpoint: Omit<EndpointFile, 'version'>,
): Promise<void> {
  await atomicWrite(paths.endpointFile, { version: 1, ...endpoint }, 0o600);
}

export async function clearEndpoint(paths: ServicePaths): Promise<void> {
  await rm(paths.endpointFile, { force: true });
}
