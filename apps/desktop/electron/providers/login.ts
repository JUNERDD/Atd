import { shell } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AuthPrompt, AuthEvent } from '@earendil-works/pi-ai';
import type { ProviderRuntime } from './runtime';
import type { LoginState } from './schema';

interface Login {
  state: LoginState;
  connectionId: string;
  abort: AbortController;
  answer: ((value: string) => void) | null;
}
export class ProviderLogin {
  private sessions = new Map<string, Login>();
  private starting = false;
  constructor(
    private runtime: ProviderRuntime,
    private publish: (state: LoginState) => void,
    private changed: () => void,
  ) {}

  async start(connectionId: string): Promise<LoginState> {
    if (
      this.starting ||
      [...this.sessions.values()].some((login) => login.state.status === 'waiting')
    )
      throw new Error('Finish or cancel the current sign-in first.');
    const connection = this.runtime.connection(connectionId);
    this.starting = true;
    let models;
    try {
      models = await this.runtime.models(connection);
    } finally {
      this.starting = false;
    }
    for (const [id, session] of this.sessions)
      if (session.state.status !== 'waiting') this.sessions.delete(id);
    const login: Login = {
      connectionId,
      abort: new AbortController(),
      answer: null,
      state: {
        id: randomUUID(),
        connectionId,
        status: 'waiting',
        message: 'Starting sign-in…',
        url: '',
        code: '',
        prompt: null,
      },
    };
    this.sessions.set(login.state.id, login);
    void models
      .login(connection.provider, connection.authType === 'oauth' ? 'oauth' : 'api_key', {
        signal: login.abort.signal,
        prompt: (prompt) => this.prompt(login, prompt),
        notify: (event) => this.notify(login, event),
      })
      .then(
        () => {
          if (!login.abort.signal.aborted) {
            login.state = {
              ...login.state,
              status: 'complete',
              message: 'Signed in. Choose a default model.',
              prompt: null,
            };
            this.changed();
          }
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
      )
      .finally(() => this.publish(login.state));
    return login.state;
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
        if (login.state.prompt?.id === id) {
          login.state = { ...login.state, prompt: null };
          this.publish(login.state);
        }
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
          message: prompt.message,
          options:
            prompt.type === 'select' ? prompt.options.map(({ id, label }) => ({ id, label })) : [],
        },
      };
      this.publish(login.state);
    });
  }
  private notify(login: Login, event: AuthEvent) {
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
    else login.state = { ...login.state, message: event.message };
    this.publish(login.state);
  }
  answer(id: string, promptId: string, value: string) {
    const login = this.sessions.get(id);
    if (!login?.answer || login.state.prompt?.id !== promptId)
      throw new Error('This sign-in prompt expired.');
    if (
      login.state.prompt.type === 'select' &&
      !login.state.prompt.options.some((option) => option.id === value)
    )
      throw new Error('Choose an available authentication option.');
    login.answer(value);
    login.state = { ...login.state, prompt: null };
    this.publish(login.state);
  }
  cancel(id: string) {
    const login = this.sessions.get(id);
    if (login?.state.status === 'waiting') {
      login.abort.abort();
      login.state = {
        ...login.state,
        status: 'cancelled',
        message: 'Sign-in cancelled.',
        prompt: null,
      };
      this.publish(login.state);
    }
  }
  cancelConnection(id: string) {
    for (const login of this.sessions.values())
      if (login.connectionId === id) this.cancel(login.state.id);
  }
  async openLink(id: string) {
    const login = this.sessions.get(id);
    if (!login || login.state.status !== 'waiting') throw new Error('This sign-in link expired.');
    const url = new URL(login.state.url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid sign-in URL.');
    await shell.openExternal(url.href);
  }
  close() {
    for (const id of this.sessions.keys()) this.cancel(id);
  }
}
