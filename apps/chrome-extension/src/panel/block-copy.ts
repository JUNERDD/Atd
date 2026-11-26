import type { ComposeBlock } from './model.ts';

/**
 * Why something in the panel cannot reach Atd now, in one vocabulary for the composer and the
 * site switch (a `ChannelBlock` is the part they share).
 */
export const BLOCK_KEYS = {
  notPaired: 'blocked.notPaired',
  connecting: 'blocked.connecting',
  notConnected: 'blocked.notConnected',
  otherHost: 'blocked.otherHost',
  serviceUnavailable: 'blocked.serviceUnavailable',
  page: 'blocked.page',
  busy: 'blocked.busy',
} as const satisfies Record<ComposeBlock, string>;
