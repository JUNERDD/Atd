import { errorMessage } from '@atd/agent-contracts';

/**
 * A model's glob (find's `pattern`, grep's `glob`) read as ripgrep reads a `--glob`, but applied
 * to the files the ignore rules let through instead of handed to rg: an rg `--glob` is an override
 * that brings ignored files back (`find '*.env'` listed gitignored secrets).
 *
 * Gitignore rules decide where a pattern matches: one without a slash matches a name at any depth,
 * one with a slash (or a leading `/`) matches from the search root, a trailing slash matches only
 * directories (so no file), and a leading `!` excludes, also every file under a directory it
 * matches, as rg skips that directory. Wildcards never cross a slash and do match a leading dot;
 * `**` spans directories; `{a,b}` alternatives nest; `[...]`, `[!...]` and backslash escapes work;
 * case counts. Paths are relative to the search root, slash-separated.
 */
export interface PathGlob {
  /** Whether the file at `relative` passes. */
  matches(relative: string): boolean;
  /**
   * A name glob every passing file's name matches, for rg's `--type-add` to narrow its walk: a
   * type, unlike a `--glob`, keeps the ignore rules. Null when the pattern bounds no name.
   */
  name: string | null;
}

export function pathGlob(glob: string): PathGlob {
  // rg trims trailing whitespace unless the last space is escaped.
  let pattern = glob.endsWith('\\ ') ? glob : glob.trimEnd();
  const negated = pattern.startsWith('!');
  if (negated) pattern = pattern.slice(1);
  const rooted = pattern.startsWith('/');
  if (rooted) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);
  if (!rooted && !pattern.includes('/') && pattern !== '**' && !pattern.startsWith('**/'))
    pattern = `**/${pattern}`;
  // `dir/**` matches what is inside the directory, not the directory itself.
  if (pattern.endsWith('/**')) pattern += '/*';
  let regex: RegExp;
  try {
    regex = new RegExp(`^${regexSource(pattern)}$`);
  } catch (error) {
    throw new Error(`Invalid glob ${JSON.stringify(glob)}: ${errorMessage(error)}`);
  }
  const file = (relative: string) => !directoryOnly && regex.test(relative);
  if (!negated) return { matches: file, name: directoryOnly ? null : nameOf(pattern) };
  return {
    matches: (relative) => {
      if (file(relative)) return false;
      for (let at = relative.indexOf('/'); at !== -1; at = relative.indexOf('/', at + 1))
        if (regex.test(relative.slice(0, at))) return false;
      return true;
    },
    name: null,
  };
}

/** The pattern's last path segment outside braces, when it narrows which names pass. */
function nameOf(pattern: string): string | null {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') index += 1;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '/' && depth === 0) start = index + 1;
  }
  const name = pattern.slice(start);
  // A type matches names only, so a slash inside braces would drop paths the pattern matches; rg
  // reads `name:glob` type definitions, so a colon cannot pass; `*` would select every file.
  return /\*\*|\/|:/.test(name) || name === '*' ? null : name;
}

/** The regular expression of a gitignore-style glob, as globset builds it (literal separators). */
function regexSource(pattern: string): string {
  let source = '';
  let depth = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? '';
    if (char === '\\') {
      index += 1;
      if (index >= pattern.length) throw new Error('dangling backslash');
      source += escape(pattern[index] ?? '');
    } else if (char === '*' && pattern[index + 1] === '*') {
      const start = index === 0 || pattern[index - 1] === '/';
      const end = index + 2 === pattern.length || pattern[index + 2] === '/';
      index += 1;
      if (start && index + 1 === pattern.length) source += '[\\s\\S]*';
      else if (start && end) {
        // `**/`: any number of directories, none included.
        source += '(?:[\\s\\S]*/)?';
        index += 1;
      } else source += '[^/]*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '[') {
      const { text, end } = characterClass(pattern, index);
      source += text;
      index = end;
    } else if (char === '{') {
      depth += 1;
      source += '(?:';
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      source += ')';
    } else if (char === ',' && depth > 0) source += '|';
    else source += escape(char);
  }
  if (depth > 0) throw new Error("unclosed alternate group; missing '}'");
  return source;
}

/** `[...]` at `start`: a leading `!` or `^` negates (never matching `/`), a first `]` is text. */
function characterClass(pattern: string, start: number): { text: string; end: number } {
  let index = start + 1;
  const negated = pattern[index] === '!' || pattern[index] === '^';
  if (negated) index += 1;
  let body = '';
  for (let first = true; index < pattern.length; index += 1, first = false) {
    const char = pattern[index] ?? '';
    if (char === ']' && !first) return { text: `[${negated ? '^/' : ''}${body}]`, end: index };
    body += char === '-' ? '-' : char.replace(/[\\\]^[]/g, '\\$&');
  }
  throw new Error("unclosed character class; missing ']'");
}

function escape(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
