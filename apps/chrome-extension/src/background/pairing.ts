import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { ShellFrameOf } from '../channel/protocol.ts';
import { STORAGE_KEYS } from '../messages/ports.ts';
import { PAIR_FAILURES, type PairFailure } from '../messages/views.ts';
import type { SendFrame } from './native.ts';
import type { Store } from './store.ts';

/**
 * Pairing with Atd (D4, K2). Connect… sends a 4-character code that Atd's confirmation shows
 * too; once the person allows it there, the shell answers `pair.state paired` with a secret,
 * which lives only in `chrome.storage.local` and in each `hello`. `unpaired`, or a `welcome` that
 * no longer knows the secret, forgets it. Failure reasons reach the popup as codes
 * (`PairFailure`), never as the shell's text.
 */

const StoredSchema = Type.Object({
  secret: Type.String({ minLength: 1, maxLength: 256 }),
  label: Type.Optional(Type.String({ maxLength: 200 })),
});

/** 32 symbols without 0/O/1/I; 256 is a multiple of 32, so every symbol is equally likely. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

export class Pairing {
  private secret: string | undefined;
  private label: string | undefined;

  constructor(
    private readonly store: Store,
    private readonly send: SendFrame,
  ) {}

  /** The kept pairing: shown as paired until Atd's `welcome` says otherwise. */
  async restore(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.pairing);
    const value: unknown = stored[STORAGE_KEYS.pairing];
    if (!Value.Check(StoredSchema, value)) return;
    this.secret = value.secret;
    this.label = value.label;
    this.store.update({ pairing: this.pairedView() });
  }

  currentSecret(): string | undefined {
    return this.secret;
  }

  /** Connect…: needs a ready channel; ignored while paired or while a request is pending. */
  start(): void {
    const { connection, pairing } = this.store.state;
    if (connection !== 'ready' || this.secret !== undefined || pairing.state === 'pending') return;
    const code = pairingCode();
    if (this.send({ t: 'pair.request', code }))
      this.store.update({ pairing: { state: 'pending', code } });
  }

  cancel(): void {
    if (this.store.state.pairing.state !== 'pending') return;
    this.send({ t: 'pair.cancel' });
    this.store.update({ pairing: { state: 'unpaired' } });
  }

  onState(frame: ShellFrameOf<'pair.state'>): void {
    switch (frame.state) {
      case 'pending': {
        const code = frame.code ?? this.store.state.pairing.code;
        this.store.update({
          pairing: { state: 'pending', ...(code === undefined ? {} : { code }) },
        });
        return;
      }
      case 'paired':
        if (frame.secret === undefined) {
          this.store.update({ pairing: { state: 'error', reason: 'failed' } });
          return;
        }
        this.keep(frame.secret, frame.label);
        return;
      case 'denied':
      case 'error':
        this.store.update({
          pairing: {
            state: frame.state,
            ...(frame.reason === undefined ? {} : { reason: pairFailure(frame.reason) }),
          },
        });
        return;
    }
  }

  /** `welcome.paired` answers the secret this `hello` carried. */
  onWelcome(paired: boolean, label: string | undefined): void {
    if (paired && this.secret !== undefined) {
      if (label !== undefined && label !== this.label) this.keep(this.secret, label);
      else this.store.update({ pairing: this.pairedView() });
    } else if (this.secret !== undefined) {
      this.forget();
    } else if (this.store.state.pairing.state === 'pending') {
      // A request still pending died with the previous connection.
      this.store.update({ pairing: { state: 'error', reason: 'notConnected' } });
    }
  }

  /** `unpaired`: the person disconnected this Chrome in Atd's settings. */
  onUnpaired(): void {
    this.forget();
  }

  /** The channel closed: a pending request cannot be answered any more. */
  onDisconnected(): void {
    if (this.store.state.pairing.state === 'pending')
      this.store.update({ pairing: { state: 'error', reason: 'notConnected' } });
  }

  private keep(secret: string, label: string | undefined): void {
    this.secret = secret;
    this.label = label;
    const value = { secret, ...(label === undefined ? {} : { label }) };
    chrome.storage.local.set({ [STORAGE_KEYS.pairing]: value }).catch((error: unknown) => {
      console.warn('[atd] could not keep the pairing', error);
    });
    this.store.update({ pairing: this.pairedView() });
  }

  private forget(): void {
    this.secret = undefined;
    this.label = undefined;
    chrome.storage.local.remove(STORAGE_KEYS.pairing).catch(() => undefined);
    this.store.update({ pairing: { state: 'unpaired' } });
  }

  private pairedView(): { state: 'paired'; label?: string } {
    return { state: 'paired', ...(this.label === undefined ? {} : { label: this.label }) };
  }
}

/** The shell's reason code as the popup knows it; a code this version does not know is `unknown`. */
function pairFailure(reason: string): PairFailure {
  return PAIR_FAILURES.find((known) => known === reason) ?? 'unknown';
}

function pairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length)).join('');
}
