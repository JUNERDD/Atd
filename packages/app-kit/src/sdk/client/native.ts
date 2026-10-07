import { base64ToBytes, bytesToBase64 } from '../../../runtime/wire.mjs';
import { USER_APP_HANDLER, type UserAppCalls } from '../../contracts.ts';

/** The reply-capable WebKit message handler the shell installs for app pages. */
interface ReplyHandler {
  postMessage(message: { type: 'call'; method: string; params: unknown }): Promise<unknown>;
}

function handler(): ReplyHandler {
  const webkit: unknown = Reflect.get(globalThis, 'webkit');
  const handlers: unknown =
    webkit !== null && typeof webkit === 'object' ? Reflect.get(webkit, 'messageHandlers') : null;
  const target: unknown =
    handlers !== null && typeof handlers === 'object'
      ? Reflect.get(handlers, USER_APP_HANDLER)
      : null;
  const postMessage: unknown =
    target !== null && typeof target === 'object' ? Reflect.get(target, 'postMessage') : null;
  if (typeof postMessage !== 'function') {
    throw new Error('Native features are available only inside an Atd app window.');
  }
  return {
    postMessage: async (message) => {
      const reply: unknown = await Reflect.apply(postMessage, target, [message]);
      return reply;
    },
  };
}

function invoke<M extends keyof UserAppCalls>(method: M, params: UserAppCalls[M]['params']) {
  return handler().postMessage({ type: 'call', method, params });
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

function readPicked(reply: unknown): PickedFile[] {
  const files: unknown =
    reply !== null && typeof reply === 'object' ? Reflect.get(reply, 'files') : null;
  if (!Array.isArray(files)) throw new Error('The file picker sent an unexpected reply.');
  return files.map((file: unknown) => {
    const name: unknown =
      file !== null && typeof file === 'object' ? Reflect.get(file, 'name') : null;
    const data: unknown =
      file !== null && typeof file === 'object' ? Reflect.get(file, 'bytesBase64') : null;
    if (typeof name !== 'string' || typeof data !== 'string') {
      throw new Error('The file picker sent an unexpected reply.');
    }
    return { name, bytes: base64ToBytes(data) };
  });
}

async function toBytes(data: Uint8Array | ArrayBuffer | Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** Native features of the app window, through the shell's narrow `atdApp` bridge. */
export const native = {
  clipboard: {
    async write(text: string): Promise<void> {
      await invoke('clipboard.write', { text });
    },
  },
  /** Opens an http(s) link in the user's browser. */
  async openLink(url: string): Promise<void> {
    const protocol = new URL(url).protocol;
    if (protocol !== 'https:' && protocol !== 'http:') {
      throw new Error('Only http and https links can be opened.');
    }
    await invoke('link.open', { url });
  },
  files: {
    /** Shows an open panel; resolves with the chosen files' bytes (empty when cancelled). */
    async pick(options: { types?: string[]; multiple?: boolean } = {}): Promise<PickedFile[]> {
      return readPicked(await invoke('files.pick', options));
    },
    /** Shows a save panel for `data`; resolves with whether the user saved it. */
    async save(
      suggestedName: string,
      data: Uint8Array | ArrayBuffer | Blob | string,
    ): Promise<boolean> {
      const bytesBase64 = bytesToBase64(await toBytes(data));
      const reply = await invoke('files.save', { suggestedName, bytesBase64 });
      return reply !== null && typeof reply === 'object' && Reflect.get(reply, 'saved') === true;
    },
  },
} as const;
