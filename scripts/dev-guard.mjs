#!/usr/bin/env node
/**
 * Preflight for `pnpm dev` and `pnpm dev:headless`.
 *
 * Both start the Vite renderer dev server on 127.0.0.1 with `strictPort`, so a second one would
 * fail late with a bare "port in use". The port is 5173 unless `AI_RENDERER_PORT` moves it, read
 * and validated as `apps/desktop/vite.config.ts` does.
 *
 * Usage: node scripts/dev-guard.mjs
 */
import { createServer } from 'node:net';

const RENDERER_HOST = '127.0.0.1';
const rendererPort = Number(process.env.AI_RENDERER_PORT ?? 5173);
if (!Number.isInteger(rendererPort) || rendererPort < 1 || rendererPort > 65535)
  fail(`AI_RENDERER_PORT must be a TCP port, not ${process.env.AI_RENDERER_PORT}.`);

if (!(await isPortFree(RENDERER_HOST, rendererPort))) {
  fail(
    `${RENDERER_HOST}:${rendererPort} is in use: pnpm dev, pnpm dev:renderer or another dev server is running. Stop it first, or set AI_RENDERER_PORT to a free port.`,
  );
}

/** Binds the port the way Vite does; a bind failure means someone else listens there. */
function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
