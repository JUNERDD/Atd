import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { errorMessage } from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import type { AdapterInternals, AdapterManagerLike, AdapterMcpConfig } from './adapter-types.js';
import { McpHostCallbacks, withUiViewerNone } from './callbacks.js';

/**
 * Zero-model control session (D6): a single Pi session that loads the
 * adapter and binds extensions for TOOL CONTROL only. It is created without
 * a model, with sampling/autoAuth disabled, cache warming off and no
 * built-in tools; prompt/followUp/steer are guarded to throw so any model
 * turn attempt is loud. Watcher/Apps `triggerTurn` deliveries are captured
 * into service events and never forwarded to the session loop.
 */

export interface ControlSessionDeps {
  agentDir: string;
  sessionsDir: string;
  cwd: string;
  internals: AdapterInternals;
  config: AdapterMcpConfig;
  callbacks: McpHostCallbacks;
  log: Logger;
}

export interface ModelCallCounts {
  prompt: number;
  followUp: number;
  steer: number;
}

export interface ControlSettingsProof {
  cacheWarming: string;
  sampling: boolean | undefined;
  autoAuth: boolean | undefined;
  elicitation: boolean | undefined;
  modelPassed: boolean;
  uiViewer: string | undefined;
}

export class ControlSession {
  private managers: AdapterManagerLike[] = [];
  private uninstallHook: (() => void) | null = null;
  private extensionPi: ExtensionAPI | null = null;
  private readonly modelCalls: ModelCallCounts = { prompt: 0, followUp: 0, steer: 0 };
  private closed = false;

  private constructor(
    readonly session: AgentSession,
    private readonly settings: SettingsManager,
    private readonly adapterConfig: AdapterMcpConfig,
    private readonly log: Logger,
  ) {}

  static async create(deps: ControlSessionDeps): Promise<ControlSession> {
    const controlDir = path.join(deps.sessionsDir, 'mcp-control');
    await mkdir(controlDir, { recursive: true });
    await mkdir(deps.agentDir, { recursive: true });
    const settings = SettingsManager.inMemory({
      retry: { enabled: false },
      defaultThinkingLevel: 'off',
      cacheWarming: 'off',
    });
    const sessions = SessionManager.create(deps.agentDir, controlDir);
    const control = new ControlSessionPlaceholder(deps);
    const loader = new DefaultResourceLoader({
      cwd: deps.cwd,
      agentDir: deps.agentDir,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: 'MCP control session. Tool control only; never issue model turns.',
      appendSystemPrompt: [],
      extensionFactories: [control.wrappedFactory()],
    });
    await loader.reload();
    if (loader.getExtensions().errors.length) {
      throw new Error('The MCP control extension could not be loaded.');
    }
    const created = await withUiViewerNone(() =>
      createAgentSession({
        cwd: deps.cwd,
        agentDir: deps.agentDir,
        settingsManager: settings,
        sessionManager: sessions,
        resourceLoader: loader,
        noTools: 'builtin',
      }),
    );
    const session = new ControlSession(created.session, settings, deps.config, deps.log);
    session.adoptPlaceholder(control);
    session.guardNoModel();
    await withUiViewerNone(() =>
      created.session.bindExtensions({
        mode: 'json',
        onError: (error) => {
          deps.log.warn('Control extension error.', { error: error.error });
        },
      }),
    );
    // The adapter initializes lazily (no session_start fires without model
    // turns), so one status call forces runtime creation; the observation
    // hook then captures the manager. This is tool control, not a model turn.
    await withUiViewerNone(() => session.callGateway({}).catch(() => undefined));
    return session;
  }

  private adoptPlaceholder(control: ControlSessionPlaceholder): void {
    this.managers = control.managers;
    this.uninstallHook = control.uninstallHook;
    control.transfer((pi) => {
      this.extensionPi = pi;
    });
  }

  /** The adapter manager observed inside the control session, if any. */
  manager(): AdapterManagerLike | null {
    return this.managers[this.managers.length - 1] ?? null;
  }

  observedManagerCount(): number {
    return this.managers.length;
  }

  /** Captured ExtensionAPI for runtime server registration (task isolation). */
  pi(): ExtensionAPI | null {
    return this.extensionPi;
  }

  /** Model-turn attempts; every counter must stay zero. */
  counts(): ModelCallCounts {
    return { ...this.modelCalls };
  }

  settingsProof(): ControlSettingsProof {
    let cacheWarming = 'unknown';
    try {
      const global = this.settings.getGlobalSettings() as { cacheWarming?: unknown };
      if (typeof global.cacheWarming === 'string') cacheWarming = global.cacheWarming;
    } catch {
      cacheWarming = 'unreadable';
    }
    return {
      cacheWarming,
      sampling: this.adapterConfig.settings?.sampling,
      autoAuth: this.adapterConfig.settings?.autoAuth,
      elicitation: this.adapterConfig.settings?.elicitation,
      modelPassed: false,
      uiViewer: process.env.MCP_UI_VIEWER,
    };
  }

  /** Waits for the adapter manager to appear after bind (init is async). */
  async waitForManager(timeoutMs = 30000): Promise<AdapterManagerLike | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.manager();
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.manager();
  }

  /**
   * Executes the public `mcp` gateway tool for status/auth flows. The
   * facade never routes tool calls through here (it uses adapter Clients
   * directly), so gateway use stays limited to status and auth actions.
   */
  async callGateway(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    this.assertOpen();
    signal?.throwIfAborted();
    const definition = this.session.extensionRunner.getToolDefinition('mcp');
    if (!definition) throw new Error('The MCP gateway tool is not registered.');
    const ctx = this.session.extensionRunner.createContext();
    return definition.execute(randomUUID(), params, signal, undefined, ctx);
  }

  async close(reason: 'quit' | 'new' = 'quit'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.session.extensionRunner.emit({ type: 'session_shutdown', reason });
    } catch (error) {
      this.log.warn('Control shutdown emit failed.', { error: errorMessage(error) });
    }
    this.session.dispose();
    this.uninstallHook?.();
    this.uninstallHook = null;
  }

  private guardNoModel(): void {
    const calls = this.modelCalls;
    const fail = (name: keyof ModelCallCounts): Promise<never> => {
      calls[name] += 1;
      return Promise.reject(
        new Error(`Control session must never call ${name} (zero-model authority).`),
      );
    };
    this.session.prompt = () => fail('prompt');
    this.session.steer = () => fail('steer');
    this.session.followUp = () => fail('followUp');
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The MCP control session is closed.');
  }
}

/**
 * Pre-bind placeholder: installs the manager observation hook and wraps
 * the adapter factory with host callbacks before Pi loads extensions.
 */
class ControlSessionPlaceholder {
  readonly managers: AdapterManagerLike[] = [];
  uninstallHook: (() => void) | null = null;
  private piReceiver: ((pi: ExtensionAPI) => void) | null = null;
  private capturedPi: ExtensionAPI | null = null;

  constructor(private readonly deps: ControlSessionDeps) {}

  transfer(receiver: (pi: ExtensionAPI) => void): void {
    if (this.capturedPi) receiver(this.capturedPi);
    else this.piReceiver = receiver;
  }

  wrappedFactory(): ExtensionFactory {
    const { internals, config, callbacks } = this.deps;
    this.uninstallHook = observeManager(internals, (manager) => {
      if (!this.managers.includes(manager)) this.managers.push(manager);
    });
    const factory = internals.createMcpAdapter({ config });
    return (pi: ExtensionAPI) => {
      this.capturedPi = pi;
      this.piReceiver?.(pi);
      this.piReceiver = null;
      factory(wrapPi(pi, callbacks));
    };
  }
}

function wrapPi(pi: ExtensionAPI, callbacks: McpHostCallbacks): ExtensionAPI {
  const wrapped = Object.create(pi) as ExtensionAPI;
  const sendMessage = pi.sendMessage.bind(pi);
  wrapped.sendMessage = ((
    message: Parameters<ExtensionAPI['sendMessage']>[0],
    options?: { triggerTurn?: boolean },
  ) => {
    callbacks.sendMessageCapture(
      message as { customType?: unknown; content?: unknown; display?: unknown; details?: unknown },
      options,
      () => sendMessage(message, options),
    );
  }) as ExtensionAPI['sendMessage'];
  const exec = pi.exec.bind(pi);
  wrapped.exec = (async (...args: Parameters<ExtensionAPI['exec']>) => {
    const [command, commandArgs] = args;
    if (!callbacks.execGuard([command, ...commandArgs])) {
      return { stdout: '', stderr: '', code: 0, killed: false };
    }
    return exec(...args);
  }) as ExtensionAPI['exec'];
  return wrapped;
}

/**
 * Host observation seam: records the adapter McpServerManager instance the
 * control session creates. No protocol or transport behavior is duplicated;
 * every call delegates to the original method.
 */
function observeManager(
  internals: AdapterInternals,
  onInstance: (manager: AdapterManagerLike) => void,
): () => void {
  const proto = internals.McpServerManager.prototype as unknown as Record<string, unknown>;
  const restorers: Array<() => void> = [];
  for (const key of [
    'connect',
    'setRuntimeSignal',
    'setOAuthRuntime',
    'setDefaultRequestTimeoutMs',
    'setTraceConfig',
    'setAuthStorageOptions',
  ]) {
    const original = proto[key];
    if (typeof original !== 'function') continue;
    const fn = original as (...args: unknown[]) => unknown;
    proto[key] = function (this: unknown, ...args: unknown[]) {
      onInstance(this as AdapterManagerLike);
      return fn.apply(this, args);
    };
    restorers.push(() => {
      proto[key] = original;
    });
  }
  return () => {
    for (const restore of restorers) restore();
  };
}
