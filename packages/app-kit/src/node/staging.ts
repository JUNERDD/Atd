import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Step 1–2 of an app build: copy the agent-written source (`output/app/`) into a staging
 * directory the toolchain reads, refusing anything that could steer the toolchain or reach
 * outside the app. The builder never runs agent JavaScript: it loads no config files and no app
 * plugins, so files that tools would otherwise pick up (package manifests, Vite/Tailwind/PostCSS/
 * TypeScript configs) are refused, as are the Tailwind CSS directives that load JavaScript into
 * the builder (`@plugin`, `@config`) or point its native scanner at other paths (`@source`,
 * `@reference`).
 */

export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 2000;
const MAX_ERRORS = 100;

export type StagingErrorCode =
  | 'source_missing'
  | 'staging_not_empty'
  | 'symlink'
  | 'hidden_file'
  | 'node_modules'
  | 'special_file'
  | 'executable'
  | 'reserved_file'
  | 'file_too_large'
  | 'total_too_large'
  | 'too_many_files'
  | 'css_directive'
  | 'missing_file';

export interface StagingError {
  code: StagingErrorCode;
  /** Relative to the app root, with `/` separators; `''` for the app as a whole. */
  path: string;
  message: string;
}

/**
 * Source that passed the staging rules. Only `prepareStaging` makes one, so `buildApp` and
 * `typecheckApp` cannot be pointed at an unchecked directory.
 */
export class StagedApp {
  readonly #dir: string;
  /** Whether the app has a backend (`server/index.ts`). */
  readonly hasServer: boolean;
  readonly files: number;
  readonly bytes: number;
  constructor(dir: string, hasServer: boolean, files: number, bytes: number) {
    this.#dir = dir;
    this.hasServer = hasServer;
    this.files = files;
    this.bytes = bytes;
  }
  /** The staging directory (a realpath). */
  get dir(): string {
    return this.#dir;
  }
}

export type StagingResult = { ok: true; app: StagedApp } | { ok: false; errors: StagingError[] };

/** File names (case-insensitive) that configure a tool, which only the service may write. */
const RESERVED = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^vite\.config\./,
  /^vitest\.config\./,
  /^tailwind\.config\./,
  /^postcss\.config\./,
  /^tsconfig(\..*)?\.json$/,
  /^jsconfig\.json$/,
];
const CSS_DIRECTIVE = /@(plugin|config|source|reference)\b/;

interface SourceFile {
  relative: string;
  absolute: string;
  size: number;
  /** Identity at validation time; the copy refuses a file that changed identity since. */
  dev: number;
  ino: number;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Checks one CSS file; comments are blanked (keeping line numbers) before matching. */
function cssErrors(relative: string, text: string): StagingError[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const match = CSS_DIRECTIVE.exec(code);
  if (!match) return [];
  return [
    {
      code: 'css_directive',
      path: relative,
      message: `${relative}:${lineOf(code, match.index)}: "@${match[1]}" is not allowed in app CSS.`,
    },
  ];
}

async function walk(root: string, errors: StagingError[]): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const fail = (code: StagingErrorCode, message: string) =>
        errors.push({ code, path: relative, message });
      if (entry.name.startsWith('.'))
        fail('hidden_file', `${relative}: hidden files are not allowed.`);
      else if (entry.name === 'node_modules')
        fail('node_modules', `${relative}: apps cannot ship node_modules.`);
      else if (entry.isSymbolicLink())
        fail('symlink', `${relative}: symbolic links are not allowed.`);
      else if (entry.isDirectory()) await visit(absolute);
      else if (!entry.isFile())
        fail('special_file', `${relative}: only regular files are allowed.`);
      else if (RESERVED.some((pattern) => pattern.test(entry.name.toLowerCase()))) {
        fail(
          'reserved_file',
          `${relative}: the build writes its own ${entry.name}; remove this file.`,
        );
      } else {
        const stat = await fs.lstat(absolute);
        if (stat.mode & 0o111) fail('executable', `${relative}: executable files are not allowed.`);
        else if (stat.size > MAX_FILE_BYTES)
          fail('file_too_large', `${relative}: larger than 8 MiB.`);
        else files.push({ relative, absolute, size: stat.size, dev: stat.dev, ino: stat.ino });
      }
    }
  };
  await visit(root);
  return files;
}

/**
 * Reads a validated file without following a symlink swapped in since validation: the final
 * component is opened `O_NOFOLLOW`, and a swapped parent directory shows as another inode.
 */
async function readValidated(file: SourceFile): Promise<Buffer> {
  const handle = await fs.open(file.absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== file.dev ||
      stat.ino !== file.ino ||
      stat.size > MAX_FILE_BYTES
    ) {
      throw new Error(`${file.relative} changed while the app was being staged.`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true;
    throw error;
  }
}

/**
 * Validates `srcDir` and copies it into `stagingDir` (which must be missing or empty). Every
 * violation is reported, up to 100; nothing is copied unless the source passes. Copies are
 * written `0644`, whatever the source mode.
 */
export async function prepareStaging(srcDir: string, stagingDir: string): Promise<StagingResult> {
  const fail = (code: StagingErrorCode, message: string): StagingResult => ({
    ok: false,
    errors: [{ code, path: '', message }],
  });
  const source = await fs.realpath(srcDir).catch(() => null);
  if (!source || !(await fs.stat(source)).isDirectory()) {
    return fail('source_missing', `${srcDir} is not a directory.`);
  }
  if (!(await isEmptyOrMissing(stagingDir))) {
    return fail('staging_not_empty', `${stagingDir} must be missing or empty.`);
  }

  const errors: StagingError[] = [];
  const files = await walk(source, errors);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes > MAX_TOTAL_BYTES) {
    errors.push({ code: 'total_too_large', path: '', message: 'The app source exceeds 16 MiB.' });
  }
  if (files.length > MAX_FILES) {
    errors.push({
      code: 'too_many_files',
      path: '',
      message: `The app has more than ${MAX_FILES} files.`,
    });
  }
  for (const required of ['atd-app.json', 'web/index.html']) {
    if (!files.some((file) => file.relative === required)) {
      errors.push({ code: 'missing_file', path: required, message: `${required} is required.` });
    }
  }
  for (const file of files.filter((candidate) => candidate.relative.endsWith('.css'))) {
    errors.push(...cssErrors(file.relative, await fs.readFile(file.absolute, 'utf8')));
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, MAX_ERRORS) };

  await fs.mkdir(stagingDir, { recursive: true });
  const target = await fs.realpath(stagingDir);
  for (const file of files) {
    const destination = path.join(target, ...file.relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, await readValidated(file), { mode: 0o644 });
  }
  const hasServer = files.some((file) => file.relative === 'server/index.ts');
  return { ok: true, app: new StagedApp(target, hasServer, files.length, bytes) };
}
