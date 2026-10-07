import { Compile } from 'typebox/compile';
import {
  APP_CAPABILITY_OPS,
  type AppCapRequest,
  type AppParentMessage,
} from '@atd/agent-contracts';
import type { Logger } from '../../logging.js';
import type { McpAuthority } from '../../mcp/index.js';
import type { AppConsents } from '../consents.js';
import { AppFailure, capabilityDenied, toAppError } from '../errors.js';
import type { AppStore } from '../store.js';
import { agentRun, type AgentRunDeps } from './agent.js';
import { generate } from './ai.js';
import { mcpCallTool, mcpListTools } from './mcp.js';
import { memoryRead, memorySearch } from './memory.js';
import { webFetch, webSearch } from './web.js';

export interface BrokerDeps extends AgentRunDeps {
  store: AppStore;
  consents: AppConsents;
  mcp: () => Promise<McpAuthority>;
  log: Logger;
}

/** Each operation's output validator: what goes back to the backend matches the contract. */
const OUTPUTS = new Map(
  Object.entries(APP_CAPABILITY_OPS).map(([name, op]) => [name, Compile(op.output)] as const),
);

/**
 * The capability proxy (plan "能力代理"): serves a backend's `cap` requests in the service, where
 * credentials stay. A capability the manifest does not list is denied without asking; one the
 * user denied is denied; one never answered waits for the user's consent (consents.ts) and is
 * denied when that is refused or times out. Every operation then runs through the module the
 * agent uses for the same thing. Answers are `capChunk`s for streaming operations and one
 * `capResult`, sent through `reply`; nothing is sent once `signal` aborted (the backend cancelled
 * or exited).
 */
export class CapabilityBroker {
  constructor(private readonly deps: BrokerDeps) {}

  handle(
    appId: string,
    request: AppCapRequest,
    reply: (message: AppParentMessage) => boolean,
    signal: AbortSignal,
  ): void {
    const { id } = request;
    const chunk = (data: unknown) => {
      if (!signal.aborted) reply({ t: 'capChunk', id, data });
    };
    void this.serve(appId, request, signal, chunk).then(
      (value) => {
        if (signal.aborted) return;
        const name = `${request.cap}.${request.op}`;
        if (OUTPUTS.get(name)?.Check(value)) reply({ t: 'capResult', id, ok: true, value });
        else {
          this.deps.log.warn('A capability answer did not match its contract.', { appId, name });
          reply({
            t: 'capResult',
            id,
            ok: false,
            error: { code: 'internal', message: `${name} produced an invalid answer.` },
          });
        }
      },
      (error: unknown) => {
        if (!signal.aborted) reply({ t: 'capResult', id, ok: false, error: toAppError(error) });
      },
    );
  }

  private async serve(
    appId: string,
    request: AppCapRequest,
    signal: AbortSignal,
    chunk: (data: unknown) => void,
  ): Promise<unknown> {
    const app = this.deps.store.get(appId);
    const cap = request.cap;
    if (!app.capabilities.includes(cap))
      throw capabilityDenied(`This app's atd-app.json does not list the "${cap}" capability.`);
    const grant = app.grants[cap];
    if (grant === 'denied')
      throw capabilityDenied(`The user denied this app the "${cap}" capability.`);
    if (grant !== 'granted') {
      const purpose = app.purposes?.[cap];
      await this.deps.consents.wait(
        { appId, appName: app.name, capability: cap, ...(purpose ? { purpose } : {}) },
        signal,
      );
    }
    return this.dispatch(appId, request, signal, chunk);
  }

  private async dispatch(
    appId: string,
    request: AppCapRequest,
    signal: AbortSignal,
    chunk: (data: unknown) => void,
  ): Promise<unknown> {
    const { paths, log } = this.deps;
    if (request.cap === 'ai') {
      if (request.op === 'generate') return generate(paths, request.input, signal);
      return generate(paths, request.input, signal, (delta) => chunk({ type: 'text', delta }));
    }
    if (request.cap === 'agent') return agentRun(this.deps, appId, request.input, signal, chunk);
    if (request.cap === 'memory') {
      if (request.op === 'search') return memorySearch(paths.agentDir, log, request.input);
      if (request.op === 'read') return memoryRead(paths.agentDir, log, request.input);
      throw new AppFailure(
        501,
        'not_implemented',
        'memory.write is not available yet: the memory store offers no way to add an entry outside a run. Use agent.run to ask the agent to remember it.',
      );
    }
    if (request.cap === 'mcp') {
      const authority = await this.deps.mcp();
      if (request.op === 'listTools') return mcpListTools(authority, request.input, signal);
      return mcpCallTool(authority, appId, request.input, signal);
    }
    if (request.op === 'search') return webSearch(request.input, signal);
    return webFetch(request.input, signal);
  }
}
