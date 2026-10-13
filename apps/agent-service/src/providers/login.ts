import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai';
import { CredentialSynchronizationError } from '@earendil-works/pi-coding-agent';
import type {
  ProviderLoginRequest,
  ProviderLoginState,
  ServiceConnection,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { connectionRuntime, type ProviderStores } from './runtime.js';
import { hasLoginErrorCode, loginFailureDiagnostic, loginFailureMessage } from './login-errors.js';
import { isChatGPT, requireChatGPTNotice } from './chatgpt-usage.js';
import type { OAuthCallback } from './oauth-callback.js';

interface Login {
  state: ProviderLoginState;
  abort: AbortController;
  answer: ((value: string) => void) | null;
  done: Promise<void>;
  deviceCode: boolean;
  interruption: 'cancelled' | 'timed-out' | null;
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

  async start(
    stores: ProviderStores,
    connection: ServiceConnection,
    options: ProviderLoginRequest = {},
  ): Promise<ProviderLoginState> {
    if (connection.authType !== 'oauth')
      throw new TypeError('Only account-login connections sign in.');
    requireChatGPTNotice(connection);
    if (options.enablePlanUsage && !isChatGPT(connection))
      throw new TypeError('Plan authorization requires a ChatGPT connection.');
    if (
      this.starting ||
      [...this.sessions.values()].some((login) => login.state.status === 'waiting')
    )
      throw new ConflictError('Finish or cancel the current sign-in first.');
    this.starting = true;
    let models;
    let callback: OAuthCallback | undefined;
    try {
      await Promise.all([...this.sessions.values()].map((login) => login.done));
      models = await connectionRuntime(stores, connection, undefined, undefined, {
        ...options,
        onCallback: (value) => {
          callback = value;
        },
      });
    } finally {
      this.starting = false;
    }
    this.sessions.clear();
    const login: Login = {
      abort: new AbortController(),
      answer: null,
      done: Promise.resolve(),
      deviceCode: false,
      interruption: null,
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
    const timeout = setTimeout(() => this.interrupt(login, 'timed-out'), 15 * 60 * 1000);
    timeout.unref();
    const attempt = async () => {
      try {
        await models.login(
          connection.provider,
          'oauth',
          {
            signal: login.abort.signal,
            prompt: (prompt) => this.prompt(login, prompt),
            notify: (event) => this.notify(login, event),
          },
          { agentName: 'Atd' },
        );
      } catch (error) {
        // Pi raises this only after this attempt's credential commit succeeded. A late abort
        // can prevent its local snapshot refresh, but cannot undo the persisted sign-in.
        if (
          error instanceof CredentialSynchronizationError &&
          error.operation === 'login' &&
          error.providerId === connection.provider
        )
          return;
        throw error;
      }
    };
    login.done = attempt()
      .catch(async (error: unknown) => {
        if (
          connection.provider !== 'radius' ||
          !hasLoginErrorCode(error, 'EADDRINUSE') ||
          login.abort.signal.aborted
        )
          throw error;
        login.deviceCode = true;
        login.state = {
          ...login.state,
          url: '',
          code: '',
          prompt: null,
          message: 'Browser callback unavailable. Starting device sign-in…',
        };
        await attempt();
      })
      .then(async () => {
        await stores.connections.reload();
        const live = stores.connections.connection(connection.connectionId);
        const plan = isChatGPT(live) ? Boolean(live.chatgptPlanEnabled) : undefined;
        login.state = {
          ...login.state,
          status: 'complete',
          message:
            plan === false
              ? 'Signed in. ChatGPT plan usage is not enabled.'
              : 'Signed in. Choose a default model.',
          ...(plan === undefined ? {} : { chatgptPlanEnabled: plan }),
          prompt: null,
          url: '',
          code: '',
        };
        await callback?.finish({
          status: 'complete',
          planEnabled: plan === true,
          backgroundAllowed: live.chatgptConsent?.backgroundAllowed === true,
        });
      })
      .catch((error: unknown) => {
        if (login.state.status !== 'waiting') return;
        const cancelled = login.interruption === 'cancelled';
        const diagnostic = login.interruption ? undefined : loginFailureDiagnostic(error);
        login.state = {
          ...login.state,
          status: cancelled ? 'cancelled' : 'error',
          ...(diagnostic ? { diagnostic } : {}),
          message:
            login.interruption === 'timed-out'
              ? 'Sign-in timed out. Start a new sign-in.'
              : cancelled
                ? 'Sign-in cancelled.'
                : loginFailureMessage(error),
          prompt: null,
          url: '',
          code: '',
        };
      })
      .then(async () => {
        clearTimeout(timeout);
        await callback?.finish({
          status: login.interruption === 'cancelled' ? 'cancelled' : 'error',
        });
      });
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

  async cancel(id: string): Promise<ProviderLoginState> {
    const login = this.session(id);
    this.interrupt(login, 'cancelled');
    await login.done;
    return login.state;
  }

  private interrupt(login: Login, reason: NonNullable<Login['interruption']>): void {
    if (login.state.status !== 'waiting' || login.interruption) return;
    login.interruption = reason;
    // Only the settled attempt can distinguish an early cancellation from a committed sign-in.
    login.state = {
      ...login.state,
      message: reason === 'cancelled' ? 'Cancelling sign-in…' : 'Sign-in timed out. Finishing…',
      prompt: null,
      url: '',
      code: '',
    };
    login.abort.abort();
  }

  /** Disconnecting a connection ends its pending sign-in. */
  async cancelConnection(connectionId: string): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((login) => login.state.connectionId === connectionId)
        .map((login) => this.cancel(login.state.id)),
    );
  }

  private session(id: string): Login {
    const login = this.sessions.get(id);
    if (!login) throw new LedgerNotFound('Sign-in', id);
    return login;
  }

  private prompt(login: Login, prompt: AuthPrompt): Promise<string> {
    login.abort.signal.throwIfAborted();
    // The desktop has a browser. Pi's browser/headless transport choice needs no user input.
    if (prompt.type === 'select' && prompt.options.some((option) => option.id === 'browser'))
      return Promise.resolve(login.deviceCode ? 'device-code' : 'browser');
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
