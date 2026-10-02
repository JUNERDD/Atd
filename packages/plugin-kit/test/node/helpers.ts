import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'tar';
import { afterEach } from 'vitest';
import type { SecretStore } from '../../src/ports.js';

export const SKILL_FIXTURE = fileURLToPath(
  new URL('../fixtures/node/skill-basic', import.meta.url),
);

const created: string[] = [];

/** A fresh temporary directory, removed after the current test. */
export async function tempDir(prefix = 'plugin-kit-'): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of created.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Copies the skill fixture to `<parent>/<name>` and returns that path. */
export async function copySkillFixture(parent: string, name = 'hello-plugin'): Promise<string> {
  const target = path.join(parent, name);
  await cp(SKILL_FIXTURE, target, { recursive: true });
  return target;
}

export interface MemorySecrets extends SecretStore {
  values: Map<string, string>;
}

export function memorySecrets(): MemorySecrets {
  const values = new Map<string, string>();
  const key = (pluginId: string, name: string) => `${pluginId}\u0000${name}`;
  return {
    values,
    get: async (pluginId, name) => values.get(key(pluginId, name)) ?? null,
    set: async (pluginId, name, value) => {
      values.set(key(pluginId, name), value);
    },
    delete: async (pluginId, name) => {
      values.delete(key(pluginId, name));
    },
  };
}

/** Packs `files` (relative path → content) under `package/` as an npm-style .tgz. */
export async function buildTarball(
  files: Record<string, string>,
  prepare?: (packageDir: string) => Promise<void>,
): Promise<Buffer> {
  const root = await tempDir('plugin-kit-pack-');
  const packageDir = path.join(root, 'package');
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(packageDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await prepare?.(packageDir);
  const output = path.join(root, 'out.tgz');
  await create({ gzip: true, cwd: root, file: output, portable: true }, ['package']);
  return readFile(output);
}

export function sri(data: Uint8Array, algorithm = 'sha512'): string {
  return `${algorithm}-${createHash(algorithm).update(data).digest('base64')}`;
}

/** A `fetch` that serves one packument and its tarballs, recording every requested URL. */
export function registryFetch(
  registry: string,
  name: string,
  packument: unknown,
  tarballs: Record<string, Buffer>,
) {
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url === `${registry}/${name.replace('/', '%2f')}`) return Response.json(packument);
    const tarball = tarballs[url];
    return tarball === undefined
      ? new Response('not found', { status: 404 })
      : new Response(new Uint8Array(tarball));
  };
  return { fetch, requests };
}

export const SKILL_MD = `---
name: npm-skill
description: A skill published to npm.
---

Body.
`;
