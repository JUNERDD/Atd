import { chromium, type Browser } from 'playwright-core';

/**
 * The worker's one browser connection: playwright-core `connectOverCDP` to the browser socket the
 * host put in `ATD_CDP_WS` after it verified it. Only a browser socket on a loopback port is
 * accepted; no caller ever names a socket or a port. A managed profile (the default channel) is
 * attached with Playwright's defaults. With `ATD_BROWSER_CHANNEL=chrome` the socket is the one the
 * shell serves for the person's own Chrome, fed by Atd for Chrome with only the tabs handed to a
 * run, and the worker connects with `noDefaults`, as Playwright documents for a daily-driver
 * browser: it takes over neither downloads nor focus emulation there.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const BROWSER_SOCKET = /^ws:\/\/127\.0\.0\.1:\d{1,5}\/devtools\/browser\/[A-Za-z0-9-]{1,128}$/;

/** `managed`: a browser profile the host manages; `chrome`: the person's own Chrome. */
export type BrowserChannel = 'managed' | 'chrome';

/** The browser socket from the environment, or undefined when it is missing or not local. */
export function browserSocketFromEnvironment(): string | undefined {
  const socket = process.env['ATD_CDP_WS'] ?? '';
  return BROWSER_SOCKET.test(socket) ? socket : undefined;
}

/** The channel the host started this worker for: `chrome`, or managed when unset; else throws. */
export function browserChannelFromEnvironment(): BrowserChannel {
  const channel = process.env['ATD_BROWSER_CHANNEL'];
  if (channel === undefined || channel === '') return 'managed';
  if (channel === 'chrome') return channel;
  throw new Error('ATD_BROWSER_CHANNEL is neither chrome nor unset.');
}

/**
 * Attaches to the browser at `socket`. `artifactsDir` is where a managed Chrome writes downloads
 * before the worker saves them (downloads.ts); over CDP, closing the returned browser only
 * detaches.
 */
export function connectBrowser(
  socket: string,
  channel: BrowserChannel,
  artifactsDir: string | undefined,
): Promise<Browser> {
  return chromium.connectOverCDP(socket, {
    isLocal: true,
    timeout: CONNECT_TIMEOUT_MS,
    ...(channel === 'chrome' ? { noDefaults: true } : {}),
    ...(artifactsDir === undefined ? {} : { artifactsDir }),
  });
}
