#!/usr/bin/env node
/**
 * Zero-dependency offline diagnostics bundle inspector.
 * Parses `/usr/bin/ditto` streaming BIT-3 `.zip` archives via EOCD + Central Directory
 * + `zlib.inflateRawSync` without extracting files to disk.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const TIMELINE_LIMIT = 15;

export function isSafeArchivePath(entryName) {
  if (!entryName || entryName.includes('\0') || entryName.includes('\\')) return false;
  if (entryName.startsWith('/') || /^[A-Za-z]:/.test(entryName)) return false;
  for (let i = 0; i < entryName.length; i += 1) {
    const code = entryName.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  const segments = entryName.split('/');
  return !segments.some((segment) => segment === '..' || segment === '.');
}

function findEocdOffset(buf) {
  const minOffset = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    if (buf.readUInt16LE(i + 20) === buf.length - (i + 22)) return i;
  }
  throw new Error('Invalid ZIP archive: End of Central Directory record not found.');
}

/** Parses Central Directory entries and inflates files using EOCD offsets (handles BIT-3 streaming headers). */
export function parseZipEntries(buf) {
  if (buf.length > MAX_ZIP_BYTES)
    throw new Error('Archive exceeds maximum supported size (64 MiB).');
  const eocd = findEocdOffset(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.');
  }
  if (cdOffset + cdSize > eocd) throw new Error('Invalid ZIP Central Directory bounds.');

  const rawEntries = new Map();
  let offset = cdOffset;
  for (let i = 0; i < totalEntries && offset < cdOffset + cdSize; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_SIG) {
      throw new Error('Invalid ZIP Central Directory entry signature.');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    if (!isSafeArchivePath(name)) throw new Error(`Unsafe archive entry path rejected: ${name}`);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Entry exceeds 16 MiB limit: ${name}`);
    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) {
      throw new Error(`Invalid ZIP Local File Header for ${name}`);
    }
    const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) throw new Error(`Truncated ZIP entry payload: ${name}`);
    const payload = buf.subarray(dataStart, dataEnd);
    const data =
      method === 0
        ? Buffer.from(payload)
        : method === 8
          ? inflateRawSync(payload, { maxOutputLength: MAX_ENTRY_BYTES })
          : (() => {
              throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
            })();
    rawEntries.set(name, data);
  }
  return stripCommonRoot(rawEntries);
}

function stripCommonRoot(entries) {
  const keys = [...entries.keys()];
  if (keys.length === 0) return entries;
  const firstSlash = keys[0].indexOf('/');
  if (firstSlash <= 0) return entries;
  const prefix = keys[0].slice(0, firstSlash + 1);
  if (!keys.every((k) => k.startsWith(prefix))) return entries;
  const normalized = new Map();
  for (const [key, value] of entries) normalized.set(key.slice(prefix.length), value);
  return normalized;
}

function parseJson(entries, key) {
  const data = entries.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data.toString('utf8'));
  } catch {
    return null;
  }
}

function collectTimeline(entries) {
  const events = [];
  const ringSources = [
    ['decision-rings/selection.json', 'ring:selection'],
    ['decision-rings/hotkeys.json', 'ring:hotkeys'],
    ['decision-rings/capture-arbiter.json', 'ring:capture-arbiter'],
    ['decision-rings/relay-supervisor.json', 'ring:relay-supervisor'],
    ['decision-rings/run-prep.json', 'ring:run-prep'],
  ];

  for (const [file, source] of ringSources) {
    const parsed = parseJson(entries, file);
    const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const anomalous =
        item.outcome === 'error' ||
        item.outcome === 'degraded' ||
        item.outcome === 'stopped' ||
        item.dropStage ||
        item.reasonCode ||
        item.errorCode ||
        item.refusalReason ||
        item.shown === false;
      if (!anomalous) continue;
      const ts = typeof item.ts === 'string' ? item.ts : typeof item.at === 'string' ? item.at : '';
      const summary =
        item.reasonCode ??
        item.dropStage ??
        item.errorCode ??
        item.phase ??
        item.outcome ??
        'anomaly';
      events.push({ ts, source, summary: String(summary) });
    }
  }

  const breadcrumbs = parseJson(entries, 'renderer-breadcrumbs.json');
  for (const item of Array.isArray(breadcrumbs?.entries) ? breadcrumbs.entries : []) {
    if (!item || typeof item !== 'object') continue;
    events.push({
      ts: typeof item.ts === 'string' ? item.ts : '',
      source: `renderer:${item.category ?? 'event'}`,
      summary: `${item.code ? `${item.code}: ` : ''}${item.message ?? ''}`.slice(0, 140),
    });
  }

  for (const logPath of ['logs/shell.tail.jsonl', 'logs/service.tail.jsonl']) {
    const raw = entries.get(logPath)?.toString('utf8');
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.level !== 'error' && row.level !== 'warn') continue;
        events.push({
          ts: typeof row.ts === 'string' ? row.ts : '',
          source: `${path.basename(logPath)}:${row.level}`,
          summary: String(row.msg ?? row.preview ?? row.raw_scrubbed ?? 'log').slice(0, 140),
        });
      } catch {
        // Ignore unparseable lines.
      }
    }
  }

  return events.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-TIMELINE_LIMIT);
}

export function inspectDiagnosticsArchive(archivePath) {
  const entries = parseZipEntries(readFileSync(archivePath));
  const manifest = parseJson(entries, 'manifest.json');
  const environment = parseJson(entries, 'environment.json');
  const doctorReport = parseJson(entries, 'doctor-report.json');
  const checks = Array.isArray(doctorReport?.checks) ? doctorReport.checks : [];
  const issues = checks
    .filter((c) => c && (c.status === 'fail' || c.status === 'warn'))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1));
  const omitted = Array.isArray(manifest?.files)
    ? manifest.files.filter((f) => f.status && f.status !== 'included')
    : [];

  return {
    archive: path.basename(archivePath),
    entryCount: entries.size,
    manifest: manifest
      ? {
          generatedAt: manifest.generatedAt ?? null,
          triggerSurface: manifest.triggerSurface ?? null,
          isDevelopment: Boolean(manifest.isDevelopment),
          totals: manifest.totals ?? null,
          omitted,
        }
      : null,
    environment: environment
      ? {
          version: environment.app?.shortVersion ?? null,
          arch: environment.host?.arch ?? null,
          rosetta: Boolean(environment.host?.isRosettaTranslated),
          placement: environment.placement?.locationCategory ?? null,
        }
      : null,
    doctor: {
      totalChecks: checks.length,
      issues: issues.map((c) => ({
        id: c.id,
        layer: c.layer,
        status: c.status,
        reasonCode: c.reasonCode,
        durationMs: c.durationMs,
        metrics: c.metrics ?? {},
      })),
    },
    timeline: collectTimeline(entries),
  };
}

function formatHuman(summary) {
  const lines = [`Diagnostics Bundle: ${summary.archive} (${summary.entryCount} entries)`];
  if (summary.manifest) {
    const t = summary.manifest.totals;
    lines.push(
      `  Generated: ${summary.manifest.generatedAt ?? 'unknown'} | Surface: ${summary.manifest.triggerSurface ?? 'unknown'} | Dev: ${summary.manifest.isDevelopment}`,
    );
    if (t) {
      lines.push(
        `  Totals: ${t.includedFiles ?? 0} included, ${t.omittedFiles ?? 0} omitted, ${t.uncompressedBytes ?? 0} B, ${t.redactionReplacements ?? 0} redactions`,
      );
    }
    for (const o of summary.manifest.omitted) {
      lines.push(`  [OMITTED] ${o.path}: ${o.status}${o.errorCode ? ` (${o.errorCode})` : ''}`);
    }
  }
  if (summary.environment) {
    const e = summary.environment;
    lines.push(
      `  Host: v${e.version ?? '?'} | arch=${e.arch ?? '?'} rosetta=${e.rosetta} | placement=${e.placement ?? '?'}`,
    );
  }
  lines.push(
    `\nDoctor Issues (${summary.doctor.issues.length}/${summary.doctor.totalChecks} checks):`,
  );
  if (summary.doctor.issues.length === 0) lines.push('  (none)');
  for (const issue of summary.doctor.issues) {
    lines.push(
      `  [${String(issue.status).toUpperCase()}] ${issue.layer} / ${issue.id} -> ${issue.reasonCode}`,
    );
  }
  lines.push(`\nAnomaly Timeline (latest ${summary.timeline.length}):`);
  if (summary.timeline.length === 0) lines.push('  (none)');
  for (const ev of summary.timeline) {
    lines.push(`  ${ev.ts || '<no-ts>'} [${ev.source}] ${ev.summary}`);
  }
  return `${lines.join('\n')}\n`;
}

function usage() {
  return [
    'Usage: node scripts/inspect-diagnostics.mjs [options] <bundle.zip>',
    '',
    'Inspects an Atd diagnostics .zip bundle (including /usr/bin/ditto BIT-3 archives) in memory.',
    '',
    'Options:',
    '  --json       Output structured JSON summary',
    '  -h, --help   Show this help message',
  ].join('\n');
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const target = positionals[0];
  if (!target) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }
  const summary = inspectDiagnosticsArchive(target);
  process.stdout.write(
    values.json ? `${JSON.stringify(summary, null, 2)}\n` : formatHuman(summary),
  );
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
