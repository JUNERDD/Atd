import { Value } from 'typebox/value';
import {
  ChunkFrameSchema,
  ShellFrameSchema,
  type ChunkFrame,
  type ShellFrame,
} from '../channel/protocol.ts';

/**
 * Inbound shell frames: chunk reassembly and validation (K2). Chrome has already parsed each
 * native message; every frame is checked against the schema of its own `t` before anything acts
 * on it, so an unknown `t` (a newer shell) is logged and ignored and a known but malformed frame is
 * logged and dropped. Logs name the frame type only, never its content (a `pair.state` carries
 * the pairing secret).
 */

type ShellFrameVariant = (typeof ShellFrameSchema.anyOf)[number];

/** Each shell frame's schema by its `t`, so a frame is checked against its own variant only. */
const SCHEMA_BY_TYPE: ReadonlyMap<string, ShellFrameVariant> = new Map(
  ShellFrameSchema.anyOf.map((schema) => [schema.properties.t.const, schema]),
);

/**
 * Bounds on reassembly. The largest frames the shell splits are worker CDP commands (Playwright's
 * injected script source is several hundred kilobytes) and run snapshots; a set past these bounds
 * is a broken or hostile sender, so it is dropped instead of growing the worker's memory.
 */
const MAX_JOINED_LENGTH = 32 * 1024 * 1024;
const MAX_PENDING_SETS = 8;

/** Joins `chunk` frames per `id` in `seq` order; an incomplete set is dropped on disconnect. */
export class ChunkJoiner {
  private readonly sets = new Map<string, { parts: string[]; length: number }>();

  /** Adds one slice and returns the joined frame text once its `last` slice arrived. */
  add(chunk: ChunkFrame): string | undefined {
    let set = this.sets.get(chunk.id);
    if (set === undefined) {
      if (chunk.seq !== 0) {
        console.warn('[atd] dropped a chunk set that did not start at seq 0');
        return undefined;
      }
      if (this.sets.size >= MAX_PENDING_SETS) {
        const oldest = this.sets.keys().next().value;
        if (oldest !== undefined) this.sets.delete(oldest);
        console.warn('[atd] dropped the oldest incomplete chunk set');
      }
      set = { parts: [], length: 0 };
      this.sets.set(chunk.id, set);
    }
    if (chunk.seq !== set.parts.length) {
      this.sets.delete(chunk.id);
      console.warn('[atd] dropped a chunk set that arrived out of order');
      return undefined;
    }
    set.length += chunk.data.length;
    if (set.length > MAX_JOINED_LENGTH) {
      this.sets.delete(chunk.id);
      console.warn('[atd] dropped a chunk set over the size limit');
      return undefined;
    }
    set.parts.push(chunk.data);
    if (!chunk.last) return undefined;
    this.sets.delete(chunk.id);
    return set.parts.join('');
  }

  /** Forgets every incomplete set (the channel closed, so their rest will never come). */
  clear(): void {
    this.sets.clear();
  }
}

/**
 * One native message as a valid shell frame, or undefined when it is a slice still waiting for
 * the rest of its set, unknown, or invalid.
 */
export function decodeShellMessage(message: unknown, chunks: ChunkJoiner): ShellFrame | undefined {
  const type = frameType(message);
  if (type !== 'chunk') return checkFrame(message, type);
  if (!Value.Check(ChunkFrameSchema, message)) {
    console.warn('[atd] dropped an invalid chunk frame');
    return undefined;
  }
  const text = chunks.add(message);
  if (text === undefined) return undefined;
  let joined: unknown;
  try {
    joined = JSON.parse(text);
  } catch {
    console.warn('[atd] dropped a joined frame that is not JSON');
    return undefined;
  }
  const joinedType = frameType(joined);
  if (joinedType === 'chunk') {
    console.warn('[atd] dropped a chunk nested in a chunk set');
    return undefined;
  }
  return checkFrame(joined, joinedType);
}

function checkFrame(value: unknown, type: string | undefined): ShellFrame | undefined {
  if (type === undefined) {
    console.warn('[atd] dropped a channel message without a frame type');
    return undefined;
  }
  const schema = SCHEMA_BY_TYPE.get(type);
  if (schema === undefined) {
    console.info(`[atd] ignored unknown frame "${type.slice(0, 64)}"`);
    return undefined;
  }
  if (!Value.Check(schema, value)) {
    console.warn(`[atd] dropped an invalid "${type}" frame`);
    return undefined;
  }
  return value;
}

function frameType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('t' in value)) return undefined;
  return typeof value.t === 'string' ? value.t : undefined;
}
