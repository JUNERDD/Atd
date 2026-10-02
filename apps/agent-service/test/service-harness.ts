import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RELAY_EPOCH_HEADER } from '@ai/agent-contracts';
import { prepareServe } from '../dist/config.js';
import { createService } from '../dist/index.js';

/**
 * A real service on a fresh data dir and product home (`AI_ATD_HOME`), listening on an OS-chosen
 * loopback port, so tests never touch the user's data. `stop` shuts it down and removes both dirs.
 */
export async function startTestService() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'agent-service-test-'));
  const atdHome = await mkdtemp(path.join(tmpdir(), 'agent-service-atd-'));
  process.env.AI_ATD_HOME = atdHome;
  const config = await prepareServe({ flagDir: dataDir, host: '127.0.0.1', port: 0 });
  const service = await createService(config);
  const baseUrl = (await service.start()).url;

  /** Fetches with the main token (unless `anonymous`), a JSON body type and an optional relay epoch. */
  function call(
    pathname: string,
    init: RequestInit & { epoch?: string | undefined; anonymous?: boolean } = {},
  ) {
    const { epoch, anonymous, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (!anonymous) headers.set('authorization', `Bearer ${config.token}`);
    if (epoch !== undefined) headers.set(RELAY_EPOCH_HEADER, epoch);
    if (rest.body !== undefined) headers.set('content-type', 'application/json');
    return fetch(`${baseUrl}${pathname}`, { ...rest, headers });
  }

  async function stop(): Promise<void> {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
    await rm(atdHome, { recursive: true, force: true });
  }

  return { config, service, baseUrl, call, stop };
}
