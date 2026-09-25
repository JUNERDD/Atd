import { stat } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Logger } from '../logging.js';

/**
 * Serves the web client build (`vite build --mode web`) at `/`. The page is hash-routed, so the
 * directory's own files are the whole surface; anything else falls through to the JSON 404.
 * Without a usable web root the service stays API-only and says so on `/`.
 */
export async function registerWebClient(
  app: FastifyInstance,
  webRoot: string | null,
  log: Logger,
): Promise<void> {
  const root = webRoot ? path.resolve(webRoot) : null;
  const usable = root
    ? await stat(path.join(root, 'index.html')).then(
        (info) => info.isFile(),
        () => false,
      )
    : false;
  if (!root || !usable) {
    if (root) log.warn('Web client build not found; serving the API only.', { webRoot: root });
    app.get('/', async (_request, reply) =>
      reply
        .status(404)
        .type('text/plain; charset=utf-8')
        .send('The web client is not built. Run `pnpm --filter @ai/desktop build:web`.'),
    );
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    // Hashed asset names change with every build; the page itself must always revalidate.
    setHeaders: (response, file) => {
      if (file.endsWith('.html')) response.header('cache-control', 'no-cache');
    },
  });
}
