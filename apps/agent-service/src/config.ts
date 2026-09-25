import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  errorMessage,
  parse,
  PROTOCOL_VERSION,
  ServiceTokenFileSchema,
  type ServiceTokenFile,
} from '@ai/agent-contracts';
import { Type, type Static } from 'typebox';
import { resolveDataDir, servicePaths, type ServicePaths } from './storage.js';

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
  },
  { additionalProperties: false },
);
export type EndpointFile = Static<typeof EndpointFileSchema>;

const LockFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    pid: Type.Integer({ minimum: 1 }),
    startedAt: Type.String(),
  },
  { additionalProperties: false },
);

export interface ServiceConfig {
  paths: ServicePaths;
  serviceId: string;
  epoch: number;
  token: string;
  host: string;
  port: number;
  /** Directory holding the web client build served at `/`; null serves the API only. */
  webRoot: string | null;
}

/** Acquires the dataDir owner lock; throws when another live owner holds it. */
export async function acquireLock(paths: ServicePaths): Promise<void> {
  await mkdir(path.dirname(paths.lockFile), { recursive: true });
  try {
    const raw = await readFile(paths.lockFile, 'utf8');
    const lock = parse(LockFileSchema, JSON.parse(raw));
    if (isAlive(lock.pid))
      throw new Error(`Another agent service (pid ${lock.pid}) owns ${paths.root}.`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error;
    if (error instanceof Error && !('code' in error)) throw error;
  }
  await atomicWrite(
    paths.lockFile,
    { version: 1, pid: process.pid, startedAt: new Date().toISOString() },
    0o600,
  );
}

export async function releaseLock(paths: ServicePaths): Promise<void> {
  await rm(paths.lockFile, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function atomicWrite(file: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', mode);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function loadServiceFile(paths: ServicePaths): Promise<ServiceFile> {
  try {
    return parse(ServiceFileSchema, JSON.parse(await readFile(paths.serviceFile, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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
    throw new Error(`Service identity could not be read: ${errorMessage(error)}`);
  }
}

async function loadToken(paths: ServicePaths, serviceId: string): Promise<string> {
  try {
    const file: ServiceTokenFile = parse(
      ServiceTokenFileSchema,
      JSON.parse(await readFile(paths.tokenFile, 'utf8')),
    );
    if (file.serviceId !== serviceId) throw new Error('Token service mismatch.');
    return file.token;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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
    throw error;
  }
}

/**
 * Prepares dataDir ownership for `serve`: resolves the dir, locks it, bumps
 * the epoch and loads the bearer token. Callers must release the lock on exit.
 */
export async function prepareServe(options: {
  envDir?: string;
  flagDir?: string;
  host?: string;
  port?: number;
  webRoot?: string;
}): Promise<ServiceConfig> {
  const root = resolveDataDir({ envDir: options.envDir, flagDir: options.flagDir });
  const paths = servicePaths(root);
  await acquireLock(paths);
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
    webRoot: options.webRoot?.trim() || null,
  };
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

export async function writeEndpoint(
  paths: ServicePaths,
  endpoint: Omit<EndpointFile, 'version'>,
): Promise<void> {
  await atomicWrite(paths.endpointFile, { version: 1, ...endpoint }, 0o600);
}

export async function clearEndpoint(paths: ServicePaths): Promise<void> {
  await rm(paths.endpointFile, { force: true });
}
