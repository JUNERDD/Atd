import type { Connection, PairingView } from '../messages/views.ts';

/**
 * The connection to Atd as the extension's own pages (the panel, the options page) present it. Each
 * page's view carries the channel and the pairing; these rules decide from them alone, so every
 * page says the same thing about the same state.
 */
export interface LinkView {
  connection: Connection;
  pairing: PairingView;
}

/**
 * Whether a page can reach Atd. The panel also counts a run the shell reports as `disconnected` as
 * lost (`panel/model.ts` `reachOf`); `channelReach` is what the channel alone says.
 */
export type Reach = 'ready' | 'connecting' | 'lost';

export function channelReach(connection: Connection): Reach {
  if (connection === 'connecting') return 'connecting';
  return connection === 'ready' ? 'ready' : 'lost';
}

/** The connection in words: the panel's toolbar, the options page's Atd group. */
export type LinkStatus = 'connected' | 'connecting' | 'notConnected';

export function linkStatus(view: LinkView, reach: Reach): LinkStatus {
  if (view.connection === 'connecting') return 'connecting';
  return view.pairing.state === 'paired' && reach === 'ready' ? 'connected' : 'notConnected';
}

/**
 * Open Atd and Computer Use Settings travel over the channel to the shell, which still answers
 * while only its service is down.
 */
export function shellAnswers(view: LinkView): boolean {
  return view.connection === 'ready' || view.connection === 'serviceUnavailable';
}

/**
 * Why nothing on a page can reach Atd now: a request, the site switch and the allowed websites'
 * removal all travel over the channel of a paired Chrome. Null when they can. A missing host reads
 * as not connected; the panel's notice already says how to finish setup.
 */
export type ChannelBlock =
  | 'notPaired'
  | 'connecting'
  | 'notConnected'
  | 'otherHost'
  | 'serviceUnavailable';

export function channelBlock(view: LinkView): ChannelBlock | null {
  if (view.pairing.state !== 'paired') return 'notPaired';
  switch (view.connection) {
    case 'ready':
      return null;
    case 'connecting':
      return 'connecting';
    case 'disconnected':
    case 'hostMissing':
    case 'browserNotVerified':
    case 'browserMismatch':
      return 'notConnected';
    case 'otherHost':
    case 'serviceUnavailable':
      return view.connection;
  }
}
