import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Type, type TSchema, type Static } from 'typebox';
import { WorkerOutboundSchema, type WorkerOutbound, type WorkerRequest } from './worker-contract';
import type { NativeRequest } from './native-schema';
import { parse, errorMessage } from './validation';

interface WorkerHost {
  event: (event: Exclude<WorkerOutbound, { type: 'response' | 'native' }>) => Promise<void>;
  native: (request: NativeRequest, onData: (data: string) => void) => Promise<unknown>;
  failed: (message: string) => void;
}

/** One isolated Pi runtime. Credentials are sent only over its private parent channel. */
export class AgentWorker {
  private process: UtilityProcess | null = null;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private ready: Promise<void> | null = null;
  private closing = false;
  constructor(
    private root: string,
    private host: WorkerHost,
  ) {}

  start(paused: boolean): Promise<void> {
    if (this.ready) return this.ready;
    this.closing = false;
    const child = utilityProcess.fork(path.join(import.meta.dirname, 'worker.js'), [], {
      serviceName: 'AI Agent',
      stdio: 'pipe',
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: path.join(this.root, 'agent'),
        AI_DESKTOP_AGENT: '1',
      },
    });
    this.process = child;
    // Do not forward provider payloads or credentials from third-party console output.
    child.stdout?.resume();
    child.stderr?.resume();
    child.on('message', (value) => {
      void this.receive(value).catch((error) => {
        this.host.failed(errorMessage(error));
        child.kill();
      });
    });
    child.on('exit', (code) => {
      if (this.process !== child) return;
      const error = new Error(
        `The Agent runtime exited (${code}). Review interrupted tasks before continuing.`,
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.process = null;
      this.ready = null;
      if (!this.closing) this.host.failed(error.message);
    });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('The Agent runtime did not start. Try loading it again.')),
        20000,
      );
    });
    this.ready = Promise.race([
      this.call({ action: 'initialize', root: this.root, paused }, Type.Null()),
      timeout,
    ])
      .then(() => undefined)
      .catch((error) => {
        this.ready = null;
        child.kill();
        throw error;
      })
      .finally(() => clearTimeout(timer));
    return this.ready;
  }

  call<T extends TSchema>(request: WorkerRequest, schema: T): Promise<Static<T>> {
    if (!this.process) return Promise.reject(new Error('The Agent runtime is unavailable.'));
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process!.postMessage({ type: 'request', id, request });
    }).then((value) => parse(schema, value));
  }

  private async receive(value: unknown) {
    const event = parse(WorkerOutboundSchema, value);
    if (event.type === 'response') {
      const pending = this.pending.get(event.id);
      this.pending.delete(event.id);
      if (event.ok) pending?.resolve(event.value);
      else pending?.reject(new Error(event.error));
    } else if (event.type === 'native') {
      try {
        const result = await this.host.native(event.request, (data) =>
          this.process?.postMessage({ type: 'nativeData', id: event.id, data }),
        );
        this.process?.postMessage({
          type: 'nativeResponse',
          id: event.id,
          ok: true,
          value: result,
          error: '',
        });
      } catch (error) {
        this.process?.postMessage({
          type: 'nativeResponse',
          id: event.id,
          ok: false,
          value: null,
          error: errorMessage(error),
        });
      }
    } else await this.host.event(event);
  }

  async close() {
    this.closing = true;
    if (!this.process) return;
    const timer = setTimeout(() => this.process?.kill(), 5000);
    try {
      await this.call({ action: 'shutdown' }, Type.Null());
    } finally {
      clearTimeout(timer);
      this.process?.kill();
    }
  }
}
