import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import { WEB_SEARCH_TOOL } from '@atd/agent-contracts';
import type { GateRequest } from '../dist/harness/gate.js';
import { childWebTools } from '../dist/harness/web-extension.js';
import { WEB_PACKAGE_VERSION } from '../dist/harness/web/package.js';

/** pi-web-access's `DuckDuckGoRateLimit`, with the options a test drives its clock through. */
interface RateLimit {
  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
type RateLimitClass = new (options: {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}) => RateLimit;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** The limiter every DuckDuckGo search goes through, from the pinned package's own source. */
async function pinnedRateLimit(): Promise<RateLimitClass> {
  const manifest = createRequire(import.meta.url).resolve('pi-web-access/package.json');
  const dir = await realpath(path.dirname(manifest));
  const version = field(
    JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')),
    'version',
  );
  assert.equal(version, WEB_PACKAGE_VERSION);
  const jiti = createJiti(path.join(dir, 'package.json'), { moduleCache: false, fsCache: false });
  const module = await jiti.import(pathToFileURL(path.join(dir, 'duckduckgo-rate-limit.ts')).href);
  const RateLimit = field(module, 'DuckDuckGoRateLimit');
  assert.equal(typeof RateLimit, 'function');
  return RateLimit as RateLimitClass;
}

function searchTool() {
  const gated: GateRequest[] = [];
  const [tool] = childWebTools(
    async (request) => {
      gated.push(request);
      throw new Error('The gate must not be reached.');
    },
    [WEB_SEARCH_TOOL],
  );
  assert.ok(tool);
  const cap = field(field(field(tool.parameters, 'properties'), 'queries'), 'maxItems');
  assert.equal(typeof cap, 'number');
  return { tool, cap: Number(cap), gated };
}

/**
 * `calls` web_search calls of `perCall` queries each, every call issued as soon as the previous
 * one settled, as an agent does; on a simulated clock where each request takes 800 ms. Returns
 * each call's per-query outcome: `ok` or the limiter's refusal.
 */
async function backToBack(RateLimit: RateLimitClass, perCall: number, calls: number) {
  let now = 0;
  const limiter = new RateLimit({ now: () => now, sleep: async (ms) => void (now += ms) });
  const search = () =>
    limiter.run(async () => {
      now += 800;
      return 'ok';
    });
  const outcomes: string[][] = [];
  for (let call = 0; call < calls; call += 1) {
    const settled = await Promise.allSettled(Array.from({ length: perCall }, search));
    outcomes.push(
      settled.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      ),
    );
  }
  return outcomes;
}

test('web_search never takes more queries than the DuckDuckGo limiter starts call after call', async () => {
  const RateLimit = await pinnedRateLimit();
  const { cap } = searchTool();
  // Four full calls stay under the limiter's ten searches per ten minutes.
  for (const outcomes of await backToBack(RateLimit, cap, 4))
    assert.deepEqual(outcomes, Array(cap).fill('ok'));
  // One more query per call and the second call already loses one, refused as rate limited.
  const [first, second] = await backToBack(RateLimit, cap + 1, 2);
  assert.deepEqual(first, Array(cap + 1).fill('ok'));
  assert.ok(
    second?.some((outcome) => /rate limited/.test(outcome)),
    `expected a refusal in ${JSON.stringify(second)}`,
  );
});

test('web_search refuses more queries than its cap before asking for approval', async () => {
  const { tool, cap, gated } = searchTool();
  const queries = Array.from({ length: cap + 1 }, (_, index) => `query ${index}`);
  await assert.rejects(
    async () => tool.execute('call-1', { queries }),
    new RegExp(`more than ${cap} items`),
  );
  assert.deepEqual(gated, []);
});
