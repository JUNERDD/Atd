import { Value } from 'typebox/value';
import {
  ChunkFrameSchema,
  ShellFrameSchema,
  type ChunkFrame,
  type ShellFrame,
} from '../channel/protocol.ts';
import type { BackgroundDiagReporter } from '../diagnostics/recorder.ts';

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

  constructor(private readonly onDiagnostic?: BackgroundDiagReporter) {}

  /** Adds one slice and returns the joined frame text once its `last` slice arrived. */
  add(chunk: ChunkFrame): string | undefined {
    let set = this.sets.get(chunk.id);
    if (set === undefined) {
      if (chunk.seq !== 0) {
        console.warn('[atd] dropped a chunk set that did not start at seq 0');
        this.onDiagnostic?.({
          level: 'warn',
          cat: 'frames',
          code: 'chunk_dropped',
          msg: 'Dropped chunk set not starting at seq 0',
        });
        return undefined;
      }
      if (this.sets.size >= MAX_PENDING_SETS) {
        const oldest = this.sets.keys().next().value;
        if (oldest !== undefined) this.sets.delete(oldest);
        console.warn('[atd] dropped the oldest incomplete chunk set');
        this.onDiagnostic?.({
          level: 'warn',
          cat: 'frames',
          code: 'chunk_dropped',
          msg: 'Dropped oldest incomplete chunk set',
        });
      }
      set = { parts: [], length: 0 };
      this.sets.set(chunk.id, set);
    }
    if (chunk.seq !== set.parts.length) {
      this.sets.delete(chunk.id);
      console.warn('[atd] dropped a chunk set that arrived out of order');
      this.onDiagnostic?.({
        level: 'warn',
        cat: 'frames',
        code: 'chunk_dropped',
        msg: 'Dropped out-of-order chunk set',
      });
      return undefined;
    }
    set.length += chunk.data.length;
    if (set.length > MAX_JOINED_LENGTH) {
      this.sets.delete(chunk.id);
      console.warn('[atd] dropped a chunk set over the size limit');
      this.onDiagnostic?.({
        level: 'warn',
        cat: 'frames',
        code: 'chunk_oversize',
        msg: 'Dropped chunk set exceeding 32 MiB limit',
      });
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
export function decodeShellMessage(
  message: unknown,
  chunks: ChunkJoiner,
  onDiagnostic?: BackgroundDiagReporter,
): ShellFrame | undefined {
  const type = frameType(message);
  if (type !== 'chunk') return checkFrame(message, type, onDiagnostic);
  if (!Value.Check(ChunkFrameSchema, message)) {
    console.warn('[atd] dropped an invalid chunk frame');
    onDiagnostic?.({
      level: 'warn',
      cat: 'frames',
      code: 'invalid_chunk',
      msg: 'Dropped invalid chunk frame',
    });
    return undefined;
  }
  const text = chunks.add(message);
  if (text === undefined) return undefined;
  let joined: unknown;
  try {
    joined = JSON.parse(text);
  } catch {
    console.warn('[atd] dropped a joined frame that is not JSON');
    onDiagnostic?.({
      level: 'warn',
      cat: 'frames',
      code: 'invalid_json',
      msg: 'Dropped joined chunk frame that is not valid JSON',
    });
    return undefined;
  }
  const joinedType = frameType(joined);
  if (joinedType === 'chunk') {
    console.warn('[atd] dropped a chunk nested in a chunk set');
    onDiagnostic?.({
      level: 'warn',
      cat: 'frames',
      code: 'nested_chunk',
      msg: 'Dropped chunk frame nested inside chunk set',
    });
    return undefined;
  }
  return checkFrame(joined, joinedType, onDiagnostic);
}

function checkFrame(
  value: unknown,
  type: string | undefined,
  onDiagnostic?: BackgroundDiagReporter,
): ShellFrame | undefined {
  if (type === undefined) {
    console.warn('[atd] dropped a channel message without a frame type');
    onDiagnostic?.({
      level: 'warn',
      cat: 'frames',
      code: 'missing_type',
      msg: 'Dropped channel message without frame type',
    });
    return undefined;
  }
  const schema = SCHEMA_BY_TYPE.get(type);
  if (schema === undefined) {
    const label = type.slice(0, 64);
    console.info(`[atd] ignored unknown frame "${label}"`);
    onDiagnostic?.({
      level: 'info',
      cat: 'frames',
      code: 'unknown_frame',
      msg: `Ignored unknown shell frame "${label}"`,
    });
    return undefined;
  }
  if (!Value.Check(schema, value)) {
    console.warn(`[atd] dropped an invalid "${type}" frame`);
    onDiagnostic?.({
      level: 'warn',
      cat: 'frames',
      code: 'invalid_frame',
      msg: `Dropped invalid "${type}" shell frame`,
    });
    return undefined;
  }
  return value;
}

function frameType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('t' in value)) return undefined;
  return typeof value.t === 'string' ? value.t : undefined;
}
