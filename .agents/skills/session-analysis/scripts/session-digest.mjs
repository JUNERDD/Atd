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
if (root && task) {
  say('', '## Run context (audit)');
  for (const r of task.runs) {
    const audit = readJsonl(path.join(root, 'audit', `${r.id}.jsonl`));
    if (!audit.length) {
      say(`- run ${r.id.slice(0, 8)}: no audit log`);
      continue;
    }
    for (const a of audit) {
      if (a.toolCallId || a.decision) {
        if (a.toolCallId) decisions.set(a.toolCallId, [...(decisions.get(a.toolCallId) ?? []), a]);
        else say(`- ${a.decision} ${a.tool} (server ${a.serverId})`);
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
    else if (e.type === 'custom')
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
  say(
    `- tokens in ${stats.input} out ${stats.output} cacheRead ${stats.cacheRead} · cost $${stats.cost.toFixed(4)}`,
  );
}
console.log(out.join('\n'));

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
