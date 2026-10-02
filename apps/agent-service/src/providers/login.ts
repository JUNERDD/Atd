import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai';
import type { ProviderLoginState, ServiceConnection } from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { connectionRuntime, type ProviderStores } from './runtime.js';

interface Login {
  state: ProviderLoginState;
  abort: AbortController;
  answer: ((value: string) => void) | null;
}

/**
 * Account sign-in sessions for OAuth connections. Pi's login flow writes the
 * credential through the connection's ServiceCredentialStore, which marks the
 * connection connected. One sign-in runs at a time; finished sessions stay
 * readable until the next sign-in starts so the caller can read the outcome.
 */
export class ProviderLogins {
  private readonly sessions = new Map<string, Login>();
  private starting = false;

  async start(stores: ProviderStores, connection: ServiceConnection): Promise<ProviderLoginState> {
    if (connection.authType !== 'oauth')
      throw new TypeError('Only account-login connections sign in.');
    if (
      this.starting ||
      [...this.sessions.values()].some((login) => login.state.status === 'waiting')
    )
      throw new ConflictError('Finish or cancel the current sign-in first.');
    this.starting = true;
    let models;
    try {
      models = await connectionRuntime(stores, connection);
    } finally {
      this.starting = false;
    }
    this.sessions.clear();
    const login: Login = {
      abort: new AbortController(),
      answer: null,
      state: {
        id: randomUUID(),
        connectionId: connection.connectionId,
        status: 'waiting',
        message: 'Starting sign-in…',
        url: '',
        code: '',
        prompt: null,
      },
    };
    this.sessions.set(login.state.id, login);
    void models
      .login(connection.provider, 'oauth', {
        signal: login.abort.signal,
        prompt: (prompt) => this.prompt(login, prompt),
        notify: (event) => this.notify(login, event),
      })
      .then(
        () => {
          if (login.abort.signal.aborted) return;
          login.state = {
            ...login.state,
            status: 'complete',
            message: 'Signed in. Choose a default model.',
            prompt: null,
          };
        },
        () => {
          login.state = {
            ...login.state,
            status: login.abort.signal.aborted ? 'cancelled' : 'error',
            message: login.abort.signal.aborted
              ? 'Sign-in cancelled.'
              : 'Sign-in failed or expired. Try again.',
            prompt: null,
          };
        },
      );
    return login.state;
  }

  get(id: string): ProviderLoginState {
    return this.session(id).state;
  }

  answer(id: string, promptId: string, value: string): ProviderLoginState {
    const login = this.session(id);
    if (!login.answer || login.state.prompt?.id !== promptId)
      throw new ConflictError('This sign-in prompt expired.');
    if (
      login.state.prompt.type === 'select' &&
      !login.state.prompt.options.some((option) => option.id === value)
    )
      throw new TypeError('Choose an available authentication option.');
    login.answer(value);
    login.state = { ...login.state, prompt: null };
    return login.state;
  }

  cancel(id: string): ProviderLoginState {
    const login = this.session(id);
    if (login.state.status === 'waiting') {
      login.abort.abort();
      login.state = {
        ...login.state,
        status: 'cancelled',
        message: 'Sign-in cancelled.',
        prompt: null,
      };
    }
    return login.state;
  }

  /** Disconnecting a connection ends its pending sign-in. */
  cancelConnection(connectionId: string): void {
    for (const login of this.sessions.values())
      if (login.state.connectionId === connectionId) this.cancel(login.state.id);
  }

  private session(id: string): Login {
    const login = this.sessions.get(id);
    if (!login) throw new LedgerNotFound('Sign-in', id);
    return login;
  }

  private prompt(login: Login, prompt: AuthPrompt): Promise<string> {
    const signal = prompt.signal
      ? AbortSignal.any([login.abort.signal, prompt.signal])
      : login.abort.signal;
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        login.answer = null;
      };
      const abort = () => {
        cleanup();
        if (login.state.prompt?.id === id) login.state = { ...login.state, prompt: null };
        reject(new Error('Sign-in prompt cancelled.'));
      };
      if (signal.aborted) {
        reject(new Error('Sign-in prompt cancelled.'));
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      login.answer = (value) => {
        cleanup();
        resolve(value);
      };
      login.state = {
        ...login.state,
        prompt: {
          id,
          type: prompt.type,
          message: prompt.message.slice(0, 2000),
          options:
            prompt.type === 'select'
              ? prompt.options.slice(0, 100).map(({ id, label }) => ({ id, label }))
              : [],
        },
      };
    });
  }

  private notify(login: Login, event: AuthEvent): void {
    if (login.abort.signal.aborted) return;
    if (event.type === 'auth_url')
      login.state = {
        ...login.state,
        url: event.url,
        message: event.instructions ?? 'Continue in your browser.',
      };
    else if (event.type === 'device_code')
      login.state = {
        ...login.state,
        url: event.verificationUri,
        code: event.userCode,
        message: 'Enter this code in your browser.',
      };
    else login.state = { ...login.state, message: event.message.slice(0, 2000) };
  }
}
