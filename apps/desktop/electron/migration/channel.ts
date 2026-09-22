import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import type { MigrationCredential } from '@ai/agent-contracts';

/**
 * Authenticated credential-upload channel to a running service. The endpoint
 * URL and bearer token come from the service dataDir files (same machine,
 * 0600 token); every upload logs only the connection id and verdict, never
 * the secret. Undecryptable connections are never uploaded.
 */
export function defaultServiceDataDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'AgentService');
    case 'win32':
      return path.join(process.env.LOCALAPPDATA ?? home, 'AgentService');
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'),
        'agent-service',
      );
  }
}

interface EndpointFile {
  url: string;
  serviceId: string;
}

interface TokenFile {
  serviceId: string;
  token: string;
}

async function readEndpoint(dataDir: string): Promise<EndpointFile> {
  const file = JSON.parse(
    await readFile(path.join(dataDir, 'endpoint.json'), 'utf8'),
  ) as EndpointFile;
  if (
    typeof file.url !== 'string' ||
    (!file.url.startsWith('http://127.0.0.1') &&
      !file.url.startsWith('http://localhost') &&
      !file.url.startsWith('http://[::1]'))
  )
    throw new Error('The service endpoint is not a loopback URL.');
  if (typeof file.serviceId !== 'string' || !file.serviceId)
    throw new Error('The service endpoint is invalid.');
  return file;
}

async function readToken(dataDir: string, serviceId: string): Promise<string> {
  const file = JSON.parse(await readFile(path.join(dataDir, 'auth', 'token'), 'utf8')) as TokenFile;
  if (file.serviceId !== serviceId || typeof file.token !== 'string' || !file.token)
    throw new Error('The service token is invalid.');
  return file.token;
}

export interface UploadVerdict {
  connectionId: string;
  uploaded: boolean;
  readable: boolean;
  modelCheck: 'unchecked' | 'passed' | 'failed';
  detail: string;
}

/** Uploads one decrypted credential; throws with a redacted message on failure. */
export async function uploadCredential(
  serviceDataDir: string,
  payload: {
    connectionId: string;
    providerId: string;
    configurationId: string;
    credential: MigrationCredential;
  },
): Promise<UploadVerdict> {
  const endpoint = await readEndpoint(serviceDataDir);
  const token = await readToken(serviceDataDir, endpoint.serviceId);
  const response = await fetch(`${endpoint.url}/v1/migration/credentials`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      connectionId: payload.connectionId,
      providerId: payload.providerId,
      configurationId: payload.configurationId,
      credential: payload.credential,
    }),
  });
  const json = (await response.json().catch(() => null)) as {
    readable?: unknown;
    modelCheck?: unknown;
    error?: { message?: unknown };
  } | null;
  if (!response.ok)
    throw new Error(
      `Upload for ${payload.connectionId} failed: ${typeof json?.error?.message === 'string' ? json.error.message : `HTTP ${response.status}`}`,
    );
  const modelCheck =
    json?.modelCheck === 'passed' || json?.modelCheck === 'failed' ? json.modelCheck : 'unchecked';
  return {
    connectionId: payload.connectionId,
    uploaded: true,
    readable: json?.readable === true,
    modelCheck,
    detail:
      modelCheck === 'passed'
        ? 'Credential stored and verified.'
        : 'Credential stored; model check inconclusive.',
  };
}
