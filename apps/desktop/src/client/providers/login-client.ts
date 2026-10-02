import {
  answerProviderLogin,
  cancelProviderLogin,
  getProviderLogin,
  startProviderLogin,
  type AgentClientOptions,
} from '@atd/agent-client';
import type { LoginState } from './schema';

const POLL_INTERVAL_MS = 1000;

/**
 * Relays account sign-in between the settings UI and the service. The service
 * runs the Pi login flow; the client polls its state while it waits, publishes
 * every change to the UI, and opens the sign-in link itself (the system browser
 * from the desktop, a new tab from the web client) because the service never
 * touches the user's browser.
 */
export class ProviderLoginClient {
  private readonly states = new Map<string, LoginState>();

  constructor(
    private readonly options: () => AgentClientOptions | null,
    private readonly publish: (state: LoginState) => void,
    private readonly signedIn: (connectionId: string) => void,
    private readonly openExternal: (url: string) => Promise<void>,
  ) {}

  async start(connectionId: string): Promise<LoginState> {
    const { login } = await startProviderLogin(this.required(), connectionId);
    this.states.clear();
    this.states.set(login.id, login);
    void this.poll(login.id);
    return login;
  }

  async answer(id: string, promptId: string, value: string): Promise<void> {
    this.record((await answerProviderLogin(this.required(), id, promptId, value)).login);
  }

  async cancel(id: string): Promise<void> {
    if (this.states.get(id)?.status !== 'waiting') return;
    this.record((await cancelProviderLogin(this.required(), id)).login);
  }

  async openLink(id: string): Promise<void> {
    const state = this.states.get(id);
    if (state?.status !== 'waiting' || !state.url) throw new Error('This sign-in link expired.');
    const url = new URL(state.url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid sign-in URL.');
    await this.openExternal(url.href);
  }

  private required(): AgentClientOptions {
    const options = this.options();
    if (!options) throw new Error('The service is not connected. Connect in Settings → Service.');
    return options;
  }

  private async poll(id: string): Promise<void> {
    while (this.states.get(id)?.status === 'waiting') {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const current = this.states.get(id);
      if (current?.status !== 'waiting') return;
      const options = this.options();
      try {
        if (!options) throw new Error('The service disconnected.');
        this.record((await getProviderLogin(options, id)).login);
      } catch {
        // A restarted service forgets its sign-ins; the flow cannot resume.
        this.record({
          ...current,
          status: 'error',
          message: 'Sign-in was interrupted. Try again.',
          prompt: null,
        });
      }
    }
  }

  /** Publishes changed states and reports a completed sign-in once. */
  private record(state: LoginState): void {
    const previous = this.states.get(state.id);
    if (!previous || JSON.stringify(previous) === JSON.stringify(state)) return;
    this.states.set(state.id, state);
    this.publish(state);
    if (state.status === 'complete' && previous.status !== 'complete')
      this.signedIn(state.connectionId);
  }
}
