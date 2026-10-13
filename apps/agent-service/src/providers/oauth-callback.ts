import { LoginFailure } from './login-errors.js';
import { createServer, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { ProviderLoginRequest } from '@atd/agent-contracts';
import type { AuthInteraction } from '@earendil-works/pi-ai';
import { oauthPage, OAUTH_PAGE_STYLE, type OAuthOutcome } from './oauth-page.js';

export type OAuthCallback = Awaited<ReturnType<typeof oauthCallback>>;
export interface ChatGPTLoginOptions extends ProviderLoginRequest {
  onCallback?: (callback: OAuthCallback) => void;
}

/** Desktop loopback transport; the OIDC client owns protocol and token validation. */
export async function oauthCallback(state: string, signal: AbortSignal, language?: 'en' | 'zh-CN') {
  signal.throwIfAborted();
  const completion = Promise.withResolvers<URL>();
  void completion.promise.catch(() => {});
  let settled = false;
  let finished = false;
  let pending: ServerResponse | undefined;
  const styleHash = createHash('sha256').update(OAUTH_PAGE_STYLE).digest('base64');
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'sha256-${styleHash}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const url = URL.parse(request.url ?? '/', 'http://127.0.0.1');
    if (
      !url ||
      request.method !== 'GET' ||
      url.pathname !== '/auth/callback' ||
      url.searchParams.get('state') !== state ||
      settled
    ) {
      response.writeHead(400).end(oauthPage({ status: 'error' }, language));
      return;
    }
    settled = true;
    pending = response;
    completion.resolve(url);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new LoginFailure('Could not start the sign-in callback.');
  }
  const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  const abort = () => completion.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  server.on('error', completion.reject);
  return {
    redirectUri,
    async wait(interaction: AuthInteraction): Promise<URL> {
      const manual = new AbortController();
      const fromBrowser = completion.promise.then((url) => new URL(url.search, redirectUri));
      const fromPaste = interaction
        .prompt({
          type: 'manual_code',
          message: 'If the browser cannot return to Atd, paste the full callback URL here.',
          placeholder: redirectUri,
          signal: AbortSignal.any([signal, manual.signal]),
        })
        .then((value) => {
          const url = new URL(value.trim());
          const expected = new URL(redirectUri);
          if (
            url.origin !== expected.origin ||
            url.pathname !== expected.pathname ||
            url.searchParams.get('state') !== state
          )
            throw new LoginFailure('Invalid sign-in callback.');
          return url;
        });
      try {
        return await Promise.race([fromBrowser, fromPaste]);
      } finally {
        manual.abort();
      }
    },
    async finish(outcome: OAuthOutcome) {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      if (pending && !pending.destroyed) {
        const response = pending;
        await new Promise<void>((resolve) => {
          response.once('finish', resolve);
          response.once('close', resolve);
          response.end(oauthPage(outcome, language));
        });
      }
      server.close();
      server.closeAllConnections();
    },
  };
}
