import type { PluginSourceSpec } from './plugin-rows';

/** An npm package name with an optional version or range: `name`, `name@1.2.3`, `@scope/name@^2`. */
const NPM_SPEC = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*(@\S+)?$/i;

function isLocalPath(text: string): boolean {
  return (
    text.startsWith('/') ||
    text.startsWith('~/') ||
    text.startsWith('./') ||
    text.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(text) ||
    text.startsWith('\\\\')
  );
}

function isGitUrl(text: string): boolean {
  return (
    /^(https?|ssh|git|git\+ssh|git\+https):\/\//i.test(text) ||
    /^[\w.-]+@[\w.-]+:/.test(text) ||
    /\.git(#|$)/.test(text)
  );
}

/**
 * Reads what the install field holds: a local folder, a Git repository, or an npm package. A Git
 * source may pin a branch, tag or commit and pick a folder inside the repository after `#`:
 * `<url>#<ref>`, `<url>#<ref>:<subdir>`, or `<url>#:<subdir>` for the default branch. Anything
 * else that looks like a package name is an npm spec (`npm:` may prefix it). Null when the text is
 * none of these.
 */
export function parsePluginSource(value: string): PluginSourceSpec | null {
  const text = value.trim();
  if (!text) return null;
  if (isLocalPath(text)) return { kind: 'local', path: text };
  if (isGitUrl(text)) {
    const hash = text.indexOf('#');
    if (hash === -1) return { kind: 'git', url: text };
    const url = text.slice(0, hash);
    const pin = text.slice(hash + 1);
    const colon = pin.indexOf(':');
    const ref = colon === -1 ? pin : pin.slice(0, colon);
    const subdir = colon === -1 ? '' : pin.slice(colon + 1);
    if (!url) return null;
    return { kind: 'git', url, ...(ref ? { ref } : {}), ...(subdir ? { subdir } : {}) };
  }
  const spec = text.replace(/^npm:/i, '');
  return NPM_SPEC.test(spec) ? { kind: 'npm', spec } : null;
}
