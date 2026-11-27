#!/usr/bin/env node
/**
 * Zero-dependency offline diagnostics bundle inspector.
 * Parses `/usr/bin/ditto` streaming BIT-3 `.zip` archives via EOCD + Central Directory
 * + `zlib.inflateRawSync` without extracting files to disk.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const TIMELINE_LIMIT = 15;
const RING_SOURCES = [
  ['decision-rings/selection.json', 'ring:selection'],
  ['decision-rings/hotkeys.json', 'ring:hotkeys'],
  ['decision-rings/capture-arbiter.json', 'ring:capture-arbiter'],
  ['decision-rings/relay-supervisor.json', 'ring:relay-supervisor'],
  ['decision-rings/run-prep.json', 'ring:run-prep'],
];
const LOG_FILES = [
  'logs/shell.tail.jsonl',
  'logs/service.tail.jsonl',
  'logs/chrome-extension.tail.jsonl',
];
const INSPECTED_FILES = new Set([
  'manifest.json',
  'environment.json',
  'doctor-report.json',
  'renderer-breadcrumbs.json',
  ...RING_SOURCES.map(([f]) => f),
  ...LOG_FILES,
]);

export function isSafeArchivePath(entryName) {
  if (!entryName || entryName.includes('\0') || entryName.includes('\\')) return false;
  if (entryName.startsWith('/') || /^[A-Za-z]:/.test(entryName)) return false;
  for (let i = 0; i < entryName.length; i += 1) {
    const code = entryName.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return !entryName.split('/').some((segment) => segment === '..' || segment === '.');
}

function findEocdOffset(buf) {
  const minOffset = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG && buf.readUInt16LE(i + 20) === buf.length - (i + 22)) {
      return i;
    }
  }
  throw new Error('Invalid ZIP archive: End of Central Directory record not found.');
}

function commonRootPrefix(names) {
  const firstSlash = names[0]?.indexOf('/') ?? -1;
  if (firstSlash <= 0) return '';
  const prefix = names[0].slice(0, firstSlash + 1);
  return names.every((n) => n.startsWith(prefix)) ? prefix : '';
}

/** Parses Central Directory entries and inflates files using EOCD offsets (handles BIT-3 streaming headers). */
export function parseZipEntries(buf, options = {}) {
  if (buf.length > MAX_ZIP_BYTES)
    throw new Error('Archive exceeds maximum supported size (64 MiB).');
  const eocd = findEocdOffset(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.');
  }
  const cdEnd = cdOffset + cdSize;
  if (cdOffset > eocd || cdEnd > eocd) throw new Error('Invalid ZIP Central Directory bounds.');

  const descriptors = [];
  let offset = cdOffset;
  let declaredTotal = 0;
  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > cdEnd || buf.readUInt32LE(offset) !== CD_SIG) {
      throw new Error('Invalid ZIP Central Directory entry signature.');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLen + extraLen + commentLen;
    if (nextOffset > cdEnd) throw new Error('Invalid ZIP Central Directory entry bounds.');
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset = nextOffset;

    if (!isSafeArchivePath(name)) throw new Error(`Unsafe archive entry path rejected: ${name}`);
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Entry exceeds 16 MiB limit: ${name}`);
    declaredTotal += uncompressedSize;
    if (declaredTotal > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Archive exceeds 32 MiB cumulative uncompressed limit.');
    }
    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) {
      throw new Error(`Invalid ZIP Local File Header for ${name}`);
    }
    const dataStart =
      localHeaderOffset +
      30 +
      buf.readUInt16LE(localHeaderOffset + 26) +
      buf.readUInt16LE(localHeaderOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) throw new Error(`Truncated ZIP entry payload: ${name}`);
    descriptors.push({ name, method, dataStart, dataEnd });
  }

  const prefix = commonRootPrefix(descriptors.map((d) => d.name));
  const onlyFiles = options.onlyFiles ?? null;
  if (options.stats) options.stats.entryCount = descriptors.length;

  const entries = new Map();
  let inflatedTotal = 0;
  for (const d of descriptors) {
    const key = prefix ? d.name.slice(prefix.length) : d.name;
    if (onlyFiles && !onlyFiles.has(key)) continue;
    const cap = Math.min(MAX_ENTRY_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES - inflatedTotal);
    if (cap <= 0) throw new Error('Archive exceeds 32 MiB cumulative uncompressed limit.');
    const payload = buf.subarray(d.dataStart, d.dataEnd);
    let data;
    if (d.method === 0) {
      if (payload.length > cap)
        throw new Error('Archive exceeds 32 MiB cumulative uncompressed limit.');
      data = Buffer.from(payload);
    } else if (d.method === 8) {
      data = inflateRawSync(payload, { maxOutputLength: cap });
    } else {
      throw new Error(`Unsupported ZIP compression method ${d.method} for ${d.name}`);
    }
    inflatedTotal += data.length;
    entries.set(key, data);
  }
  return entries;
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

function hasSecureInputFlag(flags) {
  try {
    return (BigInt(flags ?? 0) & 1024n) !== 0n;
  } catch {
    return (Number(flags ?? 0) & 1024) !== 0;
  }
}

const joinTokens = (...tokens) => tokens.filter(Boolean).join(' ');

function summarizeRingAnomaly(file, item) {
  if (file === 'decision-rings/run-prep.json') {
    const ok = ['error', 'degraded', 'stopped'].includes(item.outcome) || Boolean(item.reasonCode);
    return ok ? String(item.reasonCode ?? item.phase ?? item.outcome ?? 'anomaly') : null;
  }
  if (file === 'decision-rings/selection.json') {
    const ax0 = item.attempt0AxError ?? 0;
    const ax1 = item.attempt1AxError ?? 0;
    const secure = hasSecureInputFlag(item.flags);
    if (ax0 === 0 && ax1 === 0 && !secure) return null;
    return joinTokens(
      secure && 'secure_input',
      ax0 !== 0 && `ax_error=${ax0}`,
      ax1 !== 0 && ax1 !== ax0 && `ax1_error=${ax1}`,
      item.frontmostBundleId && `app=${item.frontmostBundleId}`,
    );
  }
  if (file === 'decision-rings/hotkeys.json') {
    const taps = item.tapDisabledCount ?? 0;
    const out = item.outcome ?? 0;
    return taps <= 0 && out < 2
      ? null
      : joinTokens(item.subject, `outcome=${out}`, taps > 0 && `tapDisabledCount=${taps}`);
  }
  if (file === 'decision-rings/capture-arbiter.json') {
    const err = item.errorCode ?? 0;
    const held = item.heldDurationMs ?? 0;
    const out = item.outcome ?? 0;
    if (err === 0 && held <= 30_000 && out < 2) return null;
    return joinTokens(
      item.ownerSummary || 'capture',
      `outcome=${out}`,
      err !== 0 && `errorCode=${err}`,
      held > 0 && `heldDurationMs=${held}`,
    );
  }
  if (file === 'decision-rings/relay-supervisor.json') {
    const out = item.outcome ?? 0;
    const crashes = item.crashCount ?? 0;
    const code = item.httpOrWsCode ?? 0;
    if (out < 2 && crashes <= 0 && code < 500) return null;
    return joinTokens(
      item.detail || 'relay',
      `outcome=${out}`,
      code > 0 && `httpOrWsCode=${code}`,
      crashes > 0 && `crashCount=${crashes}`,
    );
  }
  return null;
}

function logRowTimestamp(row) {
  for (const candidate of [row.ts, row.extTs]) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return new Date(candidate).toISOString();
    }
  }
  return '';
}

function logRowSummary(row) {
  const prefix = [row.surface, row.cat, row.code]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join('/');
  const body = String(row.msg ?? row.preview ?? row.raw_scrubbed ?? 'log');
  return (prefix ? `${prefix}: ${body}` : body).slice(0, 140);
}

function collectTimeline(entries) {
  const events = [];
  for (const [file, source] of RING_SOURCES) {
    const parsed = parseJson(entries, file);
    for (const item of Array.isArray(parsed?.entries) ? parsed.entries : []) {
      if (!item || typeof item !== 'object') continue;
      const summary = summarizeRingAnomaly(file, item);
      if (!summary) continue;
      const ts = typeof item.ts === 'string' ? item.ts : typeof item.at === 'string' ? item.at : '';
      events.push({ ts, source, summary: summary.slice(0, 140) });
    }
  }
  const bc = parseJson(entries, 'renderer-breadcrumbs.json');
  for (const item of Array.isArray(bc?.entries) ? bc.entries : []) {
    if (!item || typeof item !== 'object') continue;
    events.push({
      ts: typeof item.ts === 'string' ? item.ts : '',
      source: `renderer:${item.category ?? 'event'}`,
      summary: `${item.code ? `${item.code}: ` : ''}${item.message ?? ''}`.slice(0, 140),
    });
  }
  for (const logPath of LOG_FILES) {
    const raw = entries.get(logPath)?.toString('utf8');
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.level !== 'error' && row.level !== 'warn' && row.level !== 'fault') continue;
        events.push({
          ts: logRowTimestamp(row),
          source: `${path.basename(logPath)}:${row.level}`,
          summary: logRowSummary(row),
        });
      } catch {
        // Ignore unparseable lines.
      }
    }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-TIMELINE_LIMIT);
}

export function inspectDiagnosticsArchive(archivePath) {
  if (statSync(archivePath).size > MAX_ZIP_BYTES) {
    throw new Error('Archive exceeds maximum supported size (64 MiB).');
  }
  const stats = { entryCount: 0 };
  const entries = parseZipEntries(readFileSync(archivePath), { onlyFiles: INSPECTED_FILES, stats });
  const manifest = parseJson(entries, 'manifest.json');
  const environment = parseJson(entries, 'environment.json');
  const doc = parseJson(entries, 'doctor-report.json');
  const checks = Array.isArray(doc?.checks) ? doc.checks : [];
  const issues = checks
    .filter((c) => c && (c.status === 'fail' || c.status === 'warn'))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1));
  return {
    archive: path.basename(archivePath),
    entryCount: stats.entryCount,
    manifest: manifest
      ? {
          generatedAt: manifest.generatedAt ?? null,
          triggerSurface: manifest.triggerSurface ?? null,
          isDevelopment: Boolean(manifest.isDevelopment),
          totals: manifest.totals ?? null,
          omitted: Array.isArray(manifest.files)
            ? manifest.files.filter((f) => f.status && f.status !== 'included')
            : [],
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

function formatHuman(s) {
  const m = s.manifest;
  const t = m?.totals;
  const e = s.environment;
  const lines = [
    `Diagnostics Bundle: ${s.archive} (${s.entryCount} entries)`,
    ...(m
      ? [
          `  Generated: ${m.generatedAt ?? 'unknown'} | Surface: ${m.triggerSurface ?? 'unknown'} | Dev: ${m.isDevelopment}`,
          ...(t
            ? [
                `  Totals: ${t.includedFiles ?? 0} included, ${t.omittedFiles ?? 0} omitted, ${t.uncompressedBytes ?? 0} B, ${t.redactionReplacements ?? 0} redactions`,
              ]
            : []),
          ...m.omitted.map(
            (o) => `  [OMITTED] ${o.path}: ${o.status}${o.errorCode ? ` (${o.errorCode})` : ''}`,
          ),
        ]
      : []),
    ...(e
      ? [
          `  Host: v${e.version ?? '?'} | arch=${e.arch ?? '?'} rosetta=${e.rosetta} | placement=${e.placement ?? '?'}`,
        ]
      : []),
    `\nDoctor Issues (${s.doctor.issues.length}/${s.doctor.totalChecks} checks):`,
    ...(s.doctor.issues.length === 0
      ? ['  (none)']
      : s.doctor.issues.map(
          (i) => `  [${String(i.status).toUpperCase()}] ${i.layer} / ${i.id} -> ${i.reasonCode}`,
        )),
    `\nAnomaly Timeline (latest ${s.timeline.length}):`,
    ...(s.timeline.length === 0
      ? ['  (none)']
      : s.timeline.map((ev) => `  ${ev.ts || '<no-ts>'} [${ev.source}] ${ev.summary}`)),
  ];
  return `${lines.join('\n')}\n`;
}

const USAGE = [
  'Usage: node scripts/inspect-diagnostics.mjs [options] <bundle.zip>',
  '',
  'Inspects an Atd diagnostics .zip bundle (including /usr/bin/ditto BIT-3 archives) in memory.',
  '',
  'Options:',
  '  --json       Output structured JSON summary',
  '  -h, --help   Show this help message',
].join('\n');

function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (!positionals[0]) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }
  const summary = inspectDiagnosticsArchive(positionals[0]);
  process.stdout.write(
    values.json ? `${JSON.stringify(summary, null, 2)}\n` : formatHuman(summary),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
