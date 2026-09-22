import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { parse } from '../agent/validation';

/**
 * Desktop-side migration markers (freeze candidate `migration-markers v1`).
 * The service CLI import requires pause+flush markers (or an explicit
 * --assume-quiesced for isolated copies); the handoff marker records that
 * this desktop uploaded its credentials to one service identity.
 */
const MarkerSchema = Type.Object(
  {
    at: Type.String(),
    serviceId: Type.Union([Type.String(), Type.Null()]),
    note: Type.String(),
  },
  { additionalProperties: false },
);
export type MigrationMarker = Static<typeof MarkerSchema>;

export const PAUSE_MARKER = 'migration-paused.json';
export const FLUSH_MARKER = 'migration-flushed.json';
export const HANDOFF_MARKER = 'migration-to-service.json';

function markerFile(name: string): string {
  return path.join(app.getPath('userData'), name);
}

export async function writeMarker(
  name: string,
  marker: { serviceId: string | null; note: string },
): Promise<MigrationMarker> {
  const value: MigrationMarker = {
    at: new Date().toISOString(),
    serviceId: marker.serviceId,
    note: marker.note.slice(0, 2000),
  };
  await writeFile(markerFile(name), JSON.stringify(parse(MarkerSchema, value)), { mode: 0o600 });
  return value;
}

export async function readMarker(name: string): Promise<MigrationMarker | null> {
  try {
    return parse(MarkerSchema, JSON.parse(await readFile(markerFile(name), 'utf8')));
  } catch {
    return null;
  }
}

/** Clears the handoff marker so the desktop resumes ownership after rollback. */
export async function clearHandoff(): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(markerFile(HANDOFF_MARKER), { force: true });
}
