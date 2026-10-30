import path from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
  truncateLine,
  type AgentToolResult,
  type GrepOperations,
  type GrepToolDetails,
  type GrepToolInput,
} from '@earendil-works/pi-coding-agent';
import { resolveToolPath } from '../../service-fs.js';
import { pathGlob, type PathGlob } from './glob.js';
import { nameFilterArgs, runRipgrep } from './ripgrep.js';

/** pi's cut for one grep line (`GREP_MAX_LINE_LENGTH`, unexported), `truncateLine`'s default. */
const MAX_LINE_CHARS = 500;
const DEFAULT_LIMIT = 100;

interface Match {
  file: string;
  line: number;
  /** The matched line as rg read it; absent when it is not UTF-8. */
  text: string | undefined;
}

/**
 * One grep call: pi's grep (`core/tools/grep.js`) with the service running rg. pi builds rg's
 * arguments itself and its operations cover only directory checks and context-line reads, so it
 * could neither skip `.git` (pi passes `--hidden`) nor keep a `glob` from bringing back ignored
 * files (pi hands it to rg as an override). Here rg runs with the ignore policy find shares
 * (ripgrep.ts) and the `glob` filters the matches (glob.ts), relative to the searched directory
 * whatever the service's own cwd. Output, limits and notices are pi's, line for line.
 */
export async function runGrep(
  cwd: string,
  ops: GrepOperations,
  params: GrepToolInput,
  signal?: AbortSignal,
): Promise<AgentToolResult<GrepToolDetails | undefined>> {
  if (signal?.aborted) throw new Error('Operation aborted');
  const searchPath = resolveToolPath(cwd, params.path || '.');
  let directory: boolean;
  try {
    directory = await ops.isDirectory(searchPath);
  } catch {
    throw new Error(`Path not found: ${searchPath}`);
  }
  const limit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
  // rg searches a named file whatever the globs say; so does this.
  const glob: PathGlob | null = directory && params.glob ? pathGlob(params.glob) : null;
  const relative = (file: string) => path.relative(searchPath, file).split(path.sep).join('/');
  const args = [
    '--json',
    '--line-number',
    '--color=never',
    ...(params.ignoreCase ? ['--ignore-case'] : []),
    ...(params.literal ? ['--fixed-strings'] : []),
    ...nameFilterArgs(glob),
    '--',
    params.pattern,
    searchPath,
  ];
  const matches: Match[] = [];
  await runRipgrep(args, {
    cwd: directory ? searchPath : path.dirname(searchPath),
    signal,
    onLine: (line) => {
      const match = parseMatch(line);
      if (match && (!glob || glob.matches(relative(match.file)))) matches.push(match);
      return matches.length < limit;
    },
  });
  if (!matches.length)
    return { content: [{ type: 'text', text: 'No matches found' }], details: undefined };
  const shown = (file: string) => {
    const rel = directory ? relative(file) : '';
    return rel && !rel.startsWith('..') ? rel : path.basename(file);
  };
  return format(matches, {
    shown,
    lines: fileLines(ops),
    context: params.context && params.context > 0 ? params.context : 0,
    limit,
  });
}

/** A match event of rg's JSON output; null for any other line. */
function parseMatch(line: string): Match | null {
  if (!line.trim()) return null;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object' || !('type' in event) || event.type !== 'match')
    return null;
  const data = (event as { data?: MatchData }).data;
  const file = data?.path?.text;
  const lineNumber = data?.line_number;
  if (typeof file !== 'string' || typeof lineNumber !== 'number') return null;
  const text = data?.lines?.text;
  return { file, line: lineNumber, text: typeof text === 'string' ? text : undefined };
}

interface MatchData {
  path?: { text?: unknown };
  line_number?: unknown;
  lines?: { text?: unknown };
}

/** A file's lines for context, read once per call through the confined operations. */
function fileLines(ops: GrepOperations): (file: string) => Promise<string[]> {
  const cache = new Map<string, string[]>();
  return async (file) => {
    let lines = cache.get(file);
    if (!lines) {
      try {
        lines = (await ops.readFile(file)).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      } catch {
        lines = [];
      }
      cache.set(file, lines);
    }
    return lines;
  };
}

/** pi's grep output for `matches`: lines, context blocks, the byte cut and the notices. */
async function format(
  matches: readonly Match[],
  options: {
    shown: (file: string) => string;
    lines: (file: string) => Promise<string[]>;
    context: number;
    limit: number;
  },
): Promise<AgentToolResult<GrepToolDetails | undefined>> {
  const { shown, context, limit } = options;
  let linesTruncated = false;
  const cut = (text: string) => {
    const result = truncateLine(text, MAX_LINE_CHARS);
    if (result.wasTruncated) linesTruncated = true;
    return result.text;
  };
  const output: string[] = [];
  for (const match of matches) {
    if (context === 0 && match.text !== undefined) {
      const text = match.text.replace(/\r\n/g, '\n').replace(/\r/g, '').replace(/\n$/, '');
      output.push(`${shown(match.file)}:${match.line}: ${cut(text)}`);
      continue;
    }
    const lines = await options.lines(match.file);
    if (!lines.length) {
      output.push(`${shown(match.file)}:${match.line}: (unable to read file)`);
      continue;
    }
    const start = context > 0 ? Math.max(1, match.line - context) : match.line;
    const end = context > 0 ? Math.min(lines.length, match.line + context) : match.line;
    for (let current = start; current <= end; current += 1) {
      const text = cut((lines[current - 1] ?? '').replace(/\r/g, ''));
      const mark = current === match.line ? ':' : '-';
      output.push(`${shown(match.file)}${mark}${current}${mark} ${text}`);
    }
  }
  const truncation = truncateHead(output.join('\n'), { maxLines: Number.MAX_SAFE_INTEGER });
  const details: GrepToolDetails = {};
  const notices: string[] = [];
  if (matches.length >= limit) {
    notices.push(
      `${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`,
    );
    details.matchLimitReached = limit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  if (linesTruncated) {
    notices.push(
      `Some lines truncated to ${MAX_LINE_CHARS} chars. Use read tool to see full lines`,
    );
    details.linesTruncated = true;
  }
  const text = notices.length
    ? `${truncation.content}\n\n[${notices.join('. ')}]`
    : truncation.content;
  return {
    content: [{ type: 'text', text }],
    details: Object.keys(details).length ? details : undefined,
  };
}
