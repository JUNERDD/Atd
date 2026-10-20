import { chromium, type Browser } from 'playwright-core';

/**
 * The worker's one browser connection: playwright-core `connectOverCDP` with Playwright's
 * defaults to the browser socket the host put in `ATD_CDP_WS` after it verified it against the
 * profile's `/json/version`. Only a browser socket on a loopback port is accepted; no caller ever
 * names a socket or a port.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const BROWSER_SOCKET = /^ws:\/\/127\.0\.0\.1:\d{1,5}\/devtools\/browser\/[A-Za-z0-9-]{1,128}$/;

/** The browser socket from the environment, or undefined when it is missing or not local. */
export function browserSocketFromEnvironment(): string | undefined {
  const socket = process.env['ATD_CDP_WS'] ?? '';
  return BROWSER_SOCKET.test(socket) ? socket : undefined;
}

/**
 * Attaches to the browser at `socket`. `artifactsDir` is where Chrome writes downloads before the
 * worker saves them (downloads.ts); over CDP, closing the returned browser only detaches.
 */
export function connectBrowser(socket: string, artifactsDir: string | undefined): Promise<Browser> {
  return chromium.connectOverCDP(socket, {
    isLocal: true,
    timeout: CONNECT_TIMEOUT_MS,
    ...(artifactsDir === undefined ? {} : { artifactsDir }),
  });
}
