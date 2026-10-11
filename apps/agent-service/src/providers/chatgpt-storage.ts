import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { parse } from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';

const RegistrationSchema = Type.Object(
  {
    clientId: Type.String({ minLength: 1, maxLength: 256 }),
    subject: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    email: Type.Optional(Type.String({ maxLength: 320 })),
  },
  { additionalProperties: false },
);
export type ChatGPTRegistration = Static<typeof RegistrationSchema>;

export const ChatGPTCredentialSchema = Type.Object(
  {
    ...RegistrationSchema.properties,
    type: Type.Literal('oauth'),
    protocol: Type.Literal('siwc'),
    subject: Type.String({ minLength: 1, maxLength: 256 }),
    access: Type.String({ minLength: 1, maxLength: 8192 }),
    refresh: Type.String({ minLength: 1, maxLength: 8192 }),
    expires: Type.Number(),
    idToken: Type.String({ minLength: 1, maxLength: 16384 }),
    scopes: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type ChatGPTCredential = Static<typeof ChatGPTCredentialSchema>;

const hosts = new Map<string, Promise<string>>();

/** One opaque host identity per service installation, independent of account sign-out. */
export function chatgptHostId(dataDir: string): Promise<string> {
  let pending = hosts.get(dataDir);
  if (!pending) {
    pending = (async () => {
      const file = path.join(dataDir, 'providers', 'chatgpt-host.json');
      const schema = Type.Object({ id: Type.String({ pattern: '^urn:uuid:[0-9a-f-]{36}$' }) });
      try {
        return parse(schema, JSON.parse(await readFile(file, 'utf8'))).id;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        const id = `urn:uuid:${randomUUID()}`;
        await atomicWrite(file, { id });
        return id;
      }
    })();
    hosts.set(dataDir, pending);
    void pending.catch(() => hosts.delete(dataDir));
  }
  return pending;
}

/** Registration has no tokens. Retain it through logout and failed code exchanges. */
export class ChatGPTRegistrationStore {
  private readonly file: string;
  constructor(dataDir: string, connectionId: string) {
    this.file = path.join(dataDir, 'providers', connectionId, 'chatgpt-registration.json');
  }

  async read(): Promise<ChatGPTRegistration | undefined> {
    try {
      return parse(RegistrationSchema, JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  write(registration: ChatGPTRegistration): Promise<void> {
    return atomicWrite(this.file, parse(RegistrationSchema, registration));
  }
}
