import type { PluginDiagnostic } from '../model/diagnostics.js';

/*
 * Path handling without `node:path`, so the pure entry runs anywhere. Paths are joined
 * lexically; `..` is never resolved, so a value that contains it is rejected instead.
 */

const ABSOLUTE = /^(?:[/\\]|[A-Za-z]:[/\\])/;

function hasParentSegment(path: string): boolean {
  return path.split(/[/\\]/).includes('..');
}

/** Joins a root-relative path onto the absolute root, dropping `.` and empty segments. */
function joinRoot(root: string, relative: string): string {
  const segments = relative.split('/').filter((segment) => segment !== '' && segment !== '.');
  const joined = [root, ...segments].join('/').replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function parentSegmentDiagnostic(what: string, value: string): PluginDiagnostic {
  return {
    level: 'error',
    code: 'invalid-component',
    message: `MCP server ${what} "${value}" contains a ".." segment, which is not allowed.`,
  };
}

/** A `./` command runs from the plugin root; bare names are left for the host's PATH lookup. */
export function resolveCommand(
  command: string,
  root: string,
  diagnostics: PluginDiagnostic[],
): string {
  if (!command.startsWith('./')) return command;
  if (hasParentSegment(command)) {
    diagnostics.push(parentSegmentDiagnostic('command', command));
    return command;
  }
  return joinRoot(root, command);
}

/** The working directory defaults to the plugin root; relative values resolve against it. */
export function resolveCwd(
  cwd: string | undefined,
  root: string,
  diagnostics: PluginDiagnostic[],
): string {
  if (cwd === undefined) return root;
  if (hasParentSegment(cwd)) {
    diagnostics.push(parentSegmentDiagnostic('working directory', cwd));
    return cwd;
  }
  return ABSOLUTE.test(cwd) ? cwd : joinRoot(root, cwd);
}
