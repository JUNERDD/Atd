#!/usr/bin/env node
// Read-only digest of one agent session: ledger task + runs, per-run audit, and the Pi
// session JSONL as a numbered timeline. Accepts the session ID the
// panel copies and the other references below.
//
//   node session-digest.mjs '<link>' [--data-dir <dir>] [--max-chars N] [--full]
//
// <link>: `pi --session "<abs .jsonl>"`, a bare .jsonl path, a task id, a run id, or
// the Pi session id (the uuid suffix of the .jsonl file name).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const full = argv.includes('--full') && argv.splice(argv.indexOf('--full'), 1);
const dataDirArg = flag('--data-dir');
const MAX = full ? Infinity : Number(flag('--max-chars') ?? 600);
const input = argv.join(' ').trim();
if (!input) {
  console.error(
    'usage: session-digest.mjs \'pi --session "<path>"\' | <task-id|run-id|session-id|path>',
  );
  process.exit(2);
}

const clip = (s, n = MAX) => {
  const text = String(s ?? '')
    .replace(/\s+\n/g, '\n')
    .trim();
  return text.length > n ? `${text.slice(0, n)} …[+${text.length - n} chars]` : text;
};
const oneLine = (s, n = MAX) => clip(String(s ?? '').replace(/\s+/g, ' '), n);
const readJsonl = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line, i) => {
          try {
            return JSON.parse(line);
          } catch {
            return { type: '__unparsable', line: i + 1 };
          }
        })
    : [];
const time = (t) => (t ? new Date(t).toISOString().slice(11, 19) : '--:--:--');

// ---- resolve the data dir, task, and session file ------------------------------------
const support = path.join(os.homedir(), 'Library', 'Application Support');
const candidateRoots = [
  dataDirArg,
  process.env.AI_AGENT_DATA_DIR,
  path.join(support, 'AgentService Dev'),
  path.join(support, 'AgentService'),
].filter((d) => d && fs.existsSync(path.join(d, 'ledger.json')));

const quoted = input.match(/--session\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
const token = (quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]) : input).replace(/^["']|["']$/g, '');
const isPath = /[\\/]/.test(token) || token.endsWith('.jsonl');

let root, task, sessionFile;
if (isPath) {
  sessionFile = path.resolve(token);
  // <root>/agent/sessions/<taskId>/<file>.jsonl
  const guess = path.resolve(path.dirname(sessionFile), '..', '..', '..');
  root = fs.existsSync(path.join(guess, 'ledger.json')) ? guess : undefined;
}
for (const dir of root ? [root] : candidateRoots) {
  const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
  const found = ledger.tasks.find((t) =>
    isPath
      ? t.sessionFile === sessionFile
      : t.id === token ||
        t.runs.some((r) => r.id === token) ||
        (t.sessionFile ?? '').includes(token),
  );
  if (found) {
    root = dir;
    task = found;
    task.children = ledger.tasks.filter(
      (t) =>
        t.rootTaskId === found.id ||
        found.runs.some((r) => (t.parentExecutionId ?? '').includes(r.id)),
    );
    break;
  }
}
if (!task && !isPath) {
  console.error(
    `No task, run, or session matching "${token}" in: ${candidateRoots.join(', ') || '(no data dirs)'}`,
  );
  console.error(
    'Pass --data-dir <dir> if the session belongs to a temporary or custom AI_AGENT_DATA_DIR.',
  );
  process.exit(1);
}
sessionFile ??= task?.sessionFile ?? undefined;

// ---- header ---------------------------------------------------------------------------
const out = [];
const say = (...lines) => out.push(...lines);
say(`# Session digest`, '');
say(`- data dir: ${root ?? '(unknown — ledger not found next to the session file)'}`);
say(`- session file: ${sessionFile ?? '(none — the task never started a run)'}`);
if (task) {
  say(`- task: ${task.id} — "${task.title}"`);
  say(
    `- created ${task.createdAt} · updated ${task.updatedAt} · permissionTier ${task.permissionTier ?? '-'}`,
  );
  if (task.rootTaskId || task.parentExecutionId)
    say(`- subagent of root task ${task.rootTaskId} (parent execution ${task.parentExecutionId})`);
  for (const c of task.children)
    say(
      `- child task ${c.id} "${oneLine(c.title, 80)}" runs=[${c.runs.map((r) => r.status)}] session=${c.sessionFile ?? '-'}`,
    );
  say('', '## Runs');
  task.runs.forEach((r, i) => {
    const s = r.snapshot ?? {};
    say(
      `${i + 1}. run ${r.id} — ${r.status}${r.error ? ` — error: ${oneLine(r.error, 300)}` : ''}`,
    );
    say(
      `   model ${s.model?.provider}/${s.model?.modelId} · thinking ${s.thinkingLevel} · memory ${s.memory} · tools [${(s.tools ?? []).join(', ')}]`,
    );
    say(`   input (${s.input?.source}): ${oneLine(s.input?.text, 400)}`);
    if (s.instructions) say(`   instructions: ${oneLine(s.instructions, 300)}`);
    for (const k of ['selection', 'clipboard'])
      if (s.input?.[k]) say(`   ${k}: ${oneLine(s.input[k], 200)}`);
    if (s.input?.files?.length) say(`   files: ${JSON.stringify(s.input.files).slice(0, 300)}`);
  });
}

// ---- audit (per run) --------------------------------------------------------------------
const decisions = new Map(); // toolCallId -> audit decisions in order (e.g. review-ask, then once)
const callAt = new Map(); // toolCallId -> timestamp of the assistant message that made the call
const auditTimes = [];
if (root && task) {
  say('', '## Run context (audit)');
  for (const r of task.runs) {
    const audit = readJsonl(path.join(root, 'audit', `${r.id}.jsonl`));
    if (!audit.length) {
      say(`- run ${r.id.slice(0, 8)}: no audit log`);
      continue;
    }
    for (const a of audit) {
      const aMs = parseTimestampMs(a.ts);
      if (Number.isFinite(aMs)) auditTimes.push(aMs);
      if (a.toolCallId || a.decision) {
        if (a.toolCallId) decisions.set(a.toolCallId, [...(decisions.get(a.toolCallId) ?? []), a]);
        else {
          const server = a.serverId ? ` (server ${a.serverId})` : '';
          const reason = a.reason ? `: ${oneLine(a.reason, MAX)}` : '';
          say(`- ${a.decision} ${a.tool}${server}${reason}`);
        }
        continue;
      }
      const { ts, taskId: _taskId, runId: _runId, ...rest } = a;
      say(`- ${time(ts)} ${oneLine(JSON.stringify(rest), 400)}`);
    }
  }
}

// ---- timeline -----------------------------------------------------------------------------
const entries = sessionFile ? readJsonl(sessionFile) : [];
const stats = {
  turns: 0,
  tools: {},
  toolErrors: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cost: 0,
  stops: {},
  inferences: 0,
  firstOutputMs: 0,
  withoutOutput: 0,
};
if (entries.length) {
  const childCount = {};
  for (const e of entries)
    if (e.parentId) childCount[e.parentId] = (childCount[e.parentId] ?? 0) + 1;
  const forks = Object.entries(childCount)
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  say(
    '',
    `## Timeline (${entries.length} entries${forks.length ? `, BRANCHES at ${forks.join(', ')} — entries below are in file order, not one path` : ''})`,
  );
  let prev;
  let step = 0;
  for (const e of entries) {
    const gap = prev && e.timestamp ? (Date.parse(e.timestamp) - prev) / 1000 : 0;
    if (e.timestamp) prev = Date.parse(e.timestamp);
    const at = `${time(e.timestamp)}${gap > 30 ? ` (+${Math.round(gap)}s)` : ''}`;
    const m = e.message;
    if (e.type === 'session') say(`[${at}] session ${e.id} cwd=${e.cwd} v${e.version}`);
    else if (e.type === 'model_change') say(`[${at}] model → ${e.provider}/${e.modelId}`);
    else if (e.type === 'thinking_level_change') say(`[${at}] thinking → ${e.thinkingLevel}`);
    else if (e.type === 'compaction')
      say(
        `[${at}] COMPACTION tokensBefore=${e.tokensBefore} keep≥${e.firstKeptEntryId}: ${clip(e.summary)}`,
      );
    else if (e.type === 'branch_summary')
      say(`[${at}] BRANCH SUMMARY from ${e.fromId}: ${clip(e.summary)}`);
    else if (e.type === 'custom' && e.customType === 'app-permission') continue; // merged via audit below
    else if (e.type === 'custom' && e.customType === 'app-inference') {
      const timing = e.data ?? {};
      const hasOutput = Number.isFinite(timing.firstOutputMs);
      const wait = hasOutput ? `${(timing.firstOutputMs / 1000).toFixed(3)}s` : 'none';
      const total = Number.isFinite(timing.durationMs)
        ? `${(timing.durationMs / 1000).toFixed(3)}s`
        : '?';
      stats.inferences++;
      if (hasOutput) stats.firstOutputMs += timing.firstOutputMs;
      else stats.withoutOutput++;
      say(
        `[${at}] inference: first output ${wait} · total ${total} · ${timing.outcome ?? '?'} · message ${timing.timestamp ?? '(not started)'}`,
      );
    } else if (e.type === 'custom')
      say(`[${at}] custom:${e.customType} ${oneLine(JSON.stringify(e.data), 200)}`);
    else if (e.type === 'custom_message')
      say(`[${at}] custom_message:${e.customType} ${clip(textOf(e.content))}`);
    else if (e.type === 'label' || e.type === 'session_info')
      say(`[${at}] ${e.type} ${oneLine(JSON.stringify(e), 200)}`);
    else if (e.type === 'message' && m.role === 'user')
      say('', `[${at}] USER: ${clip(textOf(m.content), full ? Infinity : 2000)}`);
    else if (e.type === 'message' && m.role === 'system') {
      if (textOf(m.content)) say(`[${at}] SYSTEM: ${clip(textOf(m.content))}`);
    } else if (e.type === 'message' && m.role === 'assistant') {
      stats.turns++;
      const u = m.usage ?? {};
      stats.input += u.input ?? 0;
      stats.output += u.output ?? 0;
      stats.cacheRead += u.cacheRead ?? 0;
      stats.cost += u.cost?.total ?? 0;
      stats.stops[m.stopReason] = (stats.stops[m.stopReason] ?? 0) + 1;
      say(
        '',
        `[${at}] #${++step} ASSISTANT (${m.stopReason}; in ${u.input ?? '?'} out ${u.output ?? '?'} cache ${u.cacheRead ?? 0})`,
      );
      if (m.errorMessage) say(`  !! error: ${clip(m.errorMessage)}`);
      for (const c of m.content ?? []) {
        if (c.type === 'thinking') say(`  thinking: ${oneLine(c.thinking, Math.min(MAX, 400))}`);
        else if (c.type === 'text') say(`  text: ${clip(c.text)}`);
        else if (c.type === 'toolCall') {
          stats.tools[c.name] = (stats.tools[c.name] ?? 0) + 1;
          callAt.set(c.id, Date.parse(e.timestamp));
          say(`  → ${c.name} ${oneLine(JSON.stringify(c.arguments))}  [${c.id}]`);
          for (const d of decisions.get(c.id) ?? [])
            say(
              `    permission ${time(d.ts)}: ${d.decision}${d.reason ? ` — ${oneLine(d.reason, 240)}` : ''}`,
            );
        }
      }
    } else if (e.type === 'message' && m.role === 'toolResult') {
      if (m.isError) stats.toolErrors++;
      // Call → result time covers permission review, any user prompt, and execution.
      const took = (Date.parse(e.timestamp) - callAt.get(m.toolCallId)) / 1000;
      const secs = Number.isFinite(took) ? ` (${took.toFixed(1)}s)` : '';
      say(`  ← ${m.toolName}${m.isError ? ' ERROR' : ''}${secs}: ${clip(textOf(m.content))}`);
    } else
      say(`[${at}] ${e.type}${m?.role ? `/${m.role}` : ''} ${oneLine(JSON.stringify(e), 200)}`);
  }
  const first = entries.find((e) => e.timestamp)?.timestamp;
  const last = entries.findLast((e) => e.timestamp)?.timestamp;
  say('', '## Stats');
  say(
    `- wall time ${first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 1000) : '?'}s · assistant turns ${stats.turns} · stop reasons ${JSON.stringify(stats.stops)}`,
  );
  say(`- tool calls ${JSON.stringify(stats.tools)} · tool errors ${stats.toolErrors}`);
  if (stats.inferences)
    say(
      `- inference timing: ${stats.inferences} recorded · first-output wait ${(stats.firstOutputMs / 1000).toFixed(3)}s total · ${stats.withoutOutput} without output (excluded from wait total)`,
      '- First-output wait includes per-turn request/context preparation and provider waiting; it excludes tools and between-turn preparation such as compaction. It is separate from streaming generation time, not provider-only latency.',
    );
  say(
    `- tokens in ${stats.input} out ${stats.output} cacheRead ${stats.cacheRead} · cost $${stats.cost.toFixed(4)}`,
  );
}

// ---- correlated shell, extension & browser worker logs ---------------------------------
appendCorrelatedLogs();
console.log(out.join('\n'));

function parseTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

const CALL_TRACE_AFTER_DASH_RE = /^(?:waiting for\b|fill\(|navigating to\b)/i;
const INLINE_URL_RE =
  /(?<![A-Za-z0-9+.-])(?:(https?):\/\/[^\s"'`<>]+|(wss?|file|chrome-extension|chrome):\/\/[^\s"'`<>]+|(blob):(?:(?:https?|file|chrome-extension):\/\/|null\/)[^\s"'`<>]+|(data):(?:[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+)?(?:;[A-Za-z0-9!#$&^_.+-]+(?:=[A-Za-z0-9!#$&^_.+-]+)?)*,[^\s"'`<>]*)/gi;

function isCallTraceLine(trimmed) {
  if (trimmed.length < 3 || trimmed[0] !== '-' || trimmed.charCodeAt(1) > 0x20) return false;
  return CALL_TRACE_AFTER_DASH_RE.test(trimmed.slice(1).trimStart());
}

function findCallLogBoundary(text) {
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf('Call log:', from);
    if (idx < 0) return -1;
    if (idx === 0 || text.charCodeAt(idx - 1) <= 0x20) return idx;
    from = idx + 1;
  }
  return -1;
}

function stripCallLog(text) {
  const raw = String(text ?? '');
  const maxScan = Number.isNaN(MAX) ? 4096 : Math.max(MAX * 2, 4096);
  const bounded = raw.length > maxScan ? raw.slice(0, maxScan) : raw;
  const callLogIdx = findCallLogBoundary(bounded);
  const head = callLogIdx >= 0 ? bounded.slice(0, callLogIdx).trimEnd() : bounded;
  if (!head.includes('-')) return head;
  const kept = [];
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('Call log:')) break;
    if (isCallTraceLine(trimmed)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

function splitTrailingUrlPunct(rawMatch) {
  let parenBalance = 0;
  let bracketBalance = 0;
  let braceBalance = 0;
  for (let i = 0; i < rawMatch.length; i += 1) {
    const ch = rawMatch[i];
    if (ch === '(') parenBalance -= 1;
    else if (ch === ')') parenBalance += 1;
    else if (ch === '[') bracketBalance -= 1;
    else if (ch === ']') bracketBalance += 1;
    else if (ch === '{') braceBalance -= 1;
    else if (ch === '}') braceBalance += 1;
  }
  let end = rawMatch.length;
  while (end > 0) {
    const last = rawMatch[end - 1];
    if (last === '.' || last === ',' || last === ';' || last === '!') {
      end -= 1;
      continue;
    }
    if (last === ':') {
      const candidateEnd = end - 1;
      const firstColon = rawMatch.indexOf(':');
      if (
        firstColon >= 0 &&
        firstColon < candidateEnd - 1 &&
        !(
          candidateEnd >= 3 &&
          rawMatch[candidateEnd - 3] === ':' &&
          rawMatch[candidateEnd - 2] === '/' &&
          rawMatch[candidateEnd - 1] === '/'
        )
      ) {
        end = candidateEnd;
        continue;
      }
      break;
    }
    if (last === ')' && parenBalance > 0) {
      parenBalance -= 1;
      end -= 1;
      continue;
    }
    if (last === ']' && bracketBalance > 0) {
      bracketBalance -= 1;
      end -= 1;
      continue;
    }
    if (last === '}' && braceBalance > 0) {
      braceBalance -= 1;
      end -= 1;
      continue;
    }
    break;
  }
  return { url: rawMatch.slice(0, end), suffix: rawMatch.slice(end) };
}

function sanitizeHttpOrigin(url, fallbackScheme) {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== 'null') {
      return parsed.origin;
    }
  } catch {
    // Fall back to scheme-only token below.
  }
  return `${fallbackScheme.toLowerCase()}:`;
}

function scrubInlineUrls(text) {
  return text.replace(
    INLINE_URL_RE,
    (match, httpScheme, authorityScheme, blobScheme, dataScheme) => {
      const { url, suffix } = splitTrailingUrlPunct(match);
      const otherScheme = authorityScheme ?? blobScheme ?? dataScheme;
      if (otherScheme !== undefined) return `${otherScheme.toLowerCase()}:${suffix}`;
      return `${sanitizeHttpOrigin(url, httpScheme ?? 'http')}${suffix}`;
    },
  );
}

function scrubSecrets(text) {
  return scrubInlineUrls(stripCallLog(text))
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{12,})/g,
      '[redacted]',
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|authorization)\s*[:=]\s*["']?)[^\s"',;}{]+/gi,
      '$1[redacted]',
    );
}

function resolveLogSources(dataDir) {
  const isReleaseDataDir = path.basename(path.resolve(dataDir)) === 'AgentService';
  const logDir = isReleaseDataDir
    ? path.join(os.homedir(), 'Library', 'Logs', 'AI')
    : path.join(dataDir, 'logs');
  const sources = [
    { file: path.join(logDir, 'shell.1.log'), source: 'shell' },
    { file: path.join(logDir, 'shell.log'), source: 'shell' },
    { file: path.join(logDir, 'chrome-extension.1.jsonl'), source: 'chrome-extension' },
    { file: path.join(logDir, 'chrome-extension.jsonl'), source: 'chrome-extension' },
  ];
  const workersDir = path.join(dataDir, 'computer', 'browser-workers');
  if (fs.existsSync(workersDir)) {
    try {
      const names = fs
        .readdirSync(workersDir)
        .filter((name) => name.endsWith('.log'))
        .sort();
      for (const name of names) {
        const file = path.join(workersDir, name);
        if (fs.statSync(file).isFile()) {
          sources.push({ file, source: `worker:${path.basename(name, '.log')}` });
        }
      }
    } catch {
      // Read-only best effort when directory cannot be enumerated.
    }
  }
  return sources;
}

function computeTaskLogWindow() {
  const MARGIN_MS = 5_000;
  const TERMINAL_STATUSES = new Set([
    'completed',
    'failed',
    'stopped',
    'cancelled',
    'aborted',
    'errored',
    'done',
  ]);
  const runs = task?.runs ?? [];
  const entryTimes = entries.map((e) => parseTimestampMs(e.timestamp)).filter(Number.isFinite);
  const runStarts = runs
    .flatMap((r) => [parseTimestampMs(r.startedAt), parseTimestampMs(r.createdAt)])
    .filter(Number.isFinite);
  const startCandidates = [...runStarts, ...entryTimes, ...auditTimes];
  if (startCandidates.length === 0) {
    const taskCreated = parseTimestampMs(task?.createdAt);
    if (Number.isFinite(taskCreated)) startCandidates.push(taskCreated);
  }
  if (startCandidates.length === 0) return null;
  const firstRunStartMs = Math.min(...startCandidates);
  const isRunning = runs.some((r) => !TERMINAL_STATUSES.has(String(r.status ?? '').toLowerCase()));
  let lastRunEndMs;
  if (isRunning) {
    lastRunEndMs = Date.now();
  } else {
    const runEnds = runs
      .flatMap((r) => [
        parseTimestampMs(r.finishedAt),
        parseTimestampMs(r.completedAt),
        parseTimestampMs(r.updatedAt),
        parseTimestampMs(r.createdAt),
      ])
      .filter(Number.isFinite);
    const endCandidates = [
      ...runEnds,
      ...entryTimes,
      ...auditTimes,
      parseTimestampMs(task?.updatedAt),
    ].filter(Number.isFinite);
    lastRunEndMs = endCandidates.length > 0 ? Math.max(...endCandidates) : firstRunStartMs;
  }
  return {
    startMs: firstRunStartMs - MARGIN_MS,
    endMs: lastRunEndMs + MARGIN_MS,
  };
}

function formatCorrelatedLogLine(matchedMs, source, row) {
  const level = typeof row.level === 'string' && row.level ? row.level : 'info';
  const prefix = [row.surface, row.cat, row.code]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join('/');
  const rawBody = row.msg ?? row.message ?? row.preview ?? '';
  const body = oneLine(scrubSecrets(rawBody), Math.min(MAX, 300));
  const metaParts = [];
  for (const key of ['tool', 'channel', 'pageId', 'operationId', 'origin']) {
    if (typeof row[key] === 'string' && row[key].length > 0) {
      metaParts.push(`${key}=${oneLine(scrubSecrets(row[key]), 120)}`);
    }
  }
  const meta = metaParts.length > 0 ? ` (${metaParts.join(' ')})` : '';
  return `[${time(matchedMs)}] [${source}:${level}] ${prefix ? `${prefix}: ` : ''}${body}${meta}`;
}

function appendCorrelatedLogs() {
  if (!root) return;
  const window = computeTaskLogWindow();
  if (!window) return;
  const CAP = 80;
  const matched = [];
  let seq = 0;
  for (const { file, source } of resolveLogSources(root)) {
    if (!fs.existsSync(file)) continue;
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!row || typeof row !== 'object') continue;
      const extMs = parseTimestampMs(row.extTs);
      const tsMs = parseTimestampMs(row.ts);
      const matchedMs =
        Number.isFinite(extMs) && extMs >= window.startMs && extMs <= window.endMs
          ? extMs
          : Number.isFinite(tsMs) && tsMs >= window.startMs && tsMs <= window.endMs
            ? tsMs
            : NaN;
      if (!Number.isFinite(matchedMs)) continue;
      matched.push({
        ms: matchedMs,
        seq: seq++,
        text: formatCorrelatedLogLine(matchedMs, source, row),
      });
    }
  }
  if (matched.length === 0) return;
  matched.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.seq - b.seq));
  const seen = new Set();
  const deduped = [];
  for (const item of matched) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    deduped.push(item.text);
  }
  const shown = full ? deduped : deduped.slice(0, CAP);
  say('', '## Correlated Shell, Extension & Browser Worker Logs');
  if (!full && deduped.length > CAP) {
    say(`- showing ${CAP} of ${deduped.length} matching lines (pass --full for all)`);
  }
  for (const line of shown) say(line);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content ?? [])
    .map((c) =>
      c.type === 'text'
        ? c.text
        : c.type === 'image'
          ? `[image ${c.mimeType ?? ''}]`
          : `[${c.type}]`,
    )
    .join('\n');
}
