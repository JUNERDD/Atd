import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { Type, type Static } from 'typebox';
import { parse } from '../agent/validation';

const EndpointSchema = Type.Object(
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
    /** Copied from the service package's build-info.json; dev and older services omit it. */
    buildId: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);
type EndpointFile = Static<typeof EndpointSchema>;

const TokenSchema = Type.Object(
  {
    version: Type.Literal(1),
    serviceId: Type.String({ minLength: 1, maxLength: 128 }),
    token: Type.String({ minLength: 32, maxLength: 256 }),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

/** Resolved loopback endpoint + bearer token; the token never leaves main. */
export interface ServiceEndpoint {
  dataDir: string;
  baseUrl: string;
  token: string;
  serviceId: string;
  epoch: number;
  pid: number;
  /** ISO time the process started; dates the code it loaded. */
  startedAt: string;
  /** Build of the running service package; null for dev and older services. */
  buildId: string | null;
}

/**
 * The `.atd` root for the spawned service, mirroring resolveServiceDataDir: an explicit
 * AI_ATD_HOME wins; an isolated test profile (AI_TEST_USER_DATA) keeps atd skills and agents
 * inside the profile. Null leaves the service on its own ~/.atd default.
 */
export function resolveServiceAtdHome(): string | null {
  const override = process.env.AI_ATD_HOME?.trim();
  if (override) return override;
  if (!process.env.AI_TEST_USER_DATA) return null;
  return path.join(app.getPath('userData'), 'atd');
}

function isLoopbackUrl(url: string): boolean {
  return (
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://localhost') ||
    url.startsWith('http://[::1]')
  );
}

/**
 * Discovers a locally running service from its dataDir endpoint + token files.
 * Rejects non-loopback URLs, serviceId mismatches and protocol drift. The
 * token file is 0600 on disk; this module never logs or forwards the secret.
 */
function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function discoverService(dataDir: string): Promise<ServiceEndpoint> {
  const root = path.resolve(dataDir);
  let endpointText: string;
  try {
    endpointText = await readFile(path.join(root, 'endpoint.json'), 'utf8');
  } catch (error) {
    if (missingFile(error)) throw new Error('The agent service is not running.');
    throw error;
  }
  const endpoint: EndpointFile = parse(EndpointSchema, JSON.parse(endpointText));
  if (!isLoopbackUrl(endpoint.url)) throw new Error('The service endpoint is not a loopback URL.');
  if (endpoint.protocolVersion !== '1')
    throw new Error('The service protocol version is not supported.');
  const token = parse(
    TokenSchema,
    JSON.parse(await readFile(path.join(root, 'auth', 'token'), 'utf8')),
  );
  if (token.serviceId !== endpoint.serviceId)
    throw new Error('The service token does not match the endpoint.');
  try {
    process.kill(endpoint.pid, 0);
  } catch {
    throw new Error('The service endpoint is stale; the service process is gone.');
  }
  return {
    dataDir: root,
    baseUrl: endpoint.url.replace(/\/$/, ''),
    token: token.token,
    serviceId: endpoint.serviceId,
    epoch: endpoint.epoch,
    pid: endpoint.pid,
    startedAt: endpoint.startedAt,
    buildId: endpoint.buildId ?? null,
  };
}
