import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSync, type Connect, type Plugin, type ViteDevServer } from 'vite';

export interface ComponentInspectorOptions {
  enabled?: boolean;
}

interface EditorLaunch {
  executable: string;
  args: string[];
}

interface AstNode {
  type?: unknown;
  start?: unknown;
  end?: unknown;
  id?: unknown;
  name?: unknown;
  attributes?: unknown;
  selfClosing?: unknown;
  [key: string]: unknown;
}

interface Splice {
  offset: number;
  text: string;
}

const CLIENT_ENTRY = '/src/dev/component-inspector/index.ts';
const JSX_SOURCE_PATTERN = /\/src\/.*\.(?:tsx|jsx)(?:\?|$)/;

function launch(executable: string, args: string[]): EditorLaunch {
  return { executable, args };
}

/**
 * Editor CLI equivalents of the reference's shell chains, expressed as ordered
 * candidates. Each candidate is tried in order and the next one runs when the
 * executable is missing or exits with an error.
 */
export function getEditorCommands(
  editor: string,
  file: string,
  line: string,
  col: string,
): EditorLaunch[] {
  const target = `${file}:${line}:${col}`;
  switch (editor.toLowerCase()) {
    case 'code':
    case 'vscode':
      return [launch('code', ['-g', target])];
    case 'code-insiders':
      return [launch('code-insiders', ['-g', target])];
    case 'windsurf':
      return [
        launch('windsurf', ['-g', target]),
        launch(join(homedir(), '.local/bin/windsurf'), ['-g', target]),
        launch('code', ['-g', target]),
      ];
    case 'zed':
      return [launch('zed', [target])];
    case 'webstorm':
      return [
        launch('webstorm', ['--line', line, '--column', col, file]),
        launch('idea', ['--line', line, '--column', col, file]),
      ];
    case 'subl':
    case 'sublime':
      return [launch('subl', [target])];
    case 'cursor':
    default:
      return [
        launch('cursor', ['-g', target]),
        launch(join(homedir(), '.local/bin/cursor'), ['-g', target]),
        launch('code', ['-g', target]),
      ];
  }
}

function tryLaunch(command: EditorLaunch): Promise<Error | null> {
  return new Promise((resolve) => {
    execFile(command.executable, command.args, (error) => {
      resolve(error ?? null);
    });
  });
}

async function openInEditor(
  editor: string,
  file: string,
  line: string,
  col: string,
): Promise<void> {
  let lastError: Error | null = null;
  for (const command of getEditorCommands(editor, file, line, col)) {
    lastError = await tryLaunch(command);
    if (!lastError) return;
  }
  console.warn(`[component-inspector] Failed to open in ${editor}:`, lastError?.message);
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

function identifierName(node: unknown): string {
  return isAstNode(node) && node.type === 'JSXIdentifier' && typeof node.name === 'string'
    ? node.name
    : '';
}

function bindingName(node: unknown): string {
  return isAstNode(node) && node.type === 'Identifier' && typeof node.name === 'string'
    ? node.name
    : '';
}

function fileFallbackComponent(filename: string): string {
  const base =
    filename
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? '';
  return /^[A-Z]/.test(base) ? base : '';
}

function lineOffsets(code: string): number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function positionAt(starts: readonly number[], offset: number): { line: number; col: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, col: offset - (starts[low] ?? 0) + 1 };
}

function jsxAttrValue(value: string): string {
  return !value.includes('"') && !value.includes('\n') && !value.includes('\r')
    ? `"${value}"`
    : `{${JSON.stringify(value)}}`;
}

function hasInspectorAttr(attributes: unknown): boolean {
  if (!Array.isArray(attributes)) return false;
  return attributes.some(
    (attr) =>
      isAstNode(attr) &&
      attr.type === 'JSXAttribute' &&
      identifierName(attr.name) === 'data-insp-file',
  );
}

/**
 * Tags every JSX opening element with its source location and owning component using Vite's
 * native OXC parser so dev transforms skip Babel's JS parser/generator overhead.
 */
export function transformComponentInspector(code: string, id: string): string | null {
  const filename = id.split('?', 1)[0] ?? '';
  if (!JSX_SOURCE_PATTERN.test(filename) || !code.includes('<')) return null;

  const parsed = parseSync(filename, code);
  if (parsed.errors.length > 0) return null;

  const starts = lineOffsets(code);
  const fileFallback = fileFallbackComponent(filename);
  const encodedFile = jsxAttrValue(filename);
  const names: string[] = [];
  const splices: Splice[] = [];

  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return;
    const type = node.type;
    let pushed = false;
    if (
      type === 'FunctionDeclaration' ||
      type === 'FunctionExpression' ||
      type === 'VariableDeclarator'
    ) {
      const name = bindingName(node.id);
      if (name) {
        names.push(name);
        pushed = true;
      }
    }

    if (
      type === 'JSXOpeningElement' &&
      typeof node.start === 'number' &&
      typeof node.end === 'number' &&
      !hasInspectorAttr(node.attributes)
    ) {
      const selfClosing = node.selfClosing === true;
      const offset = selfClosing ? node.end - 2 : node.end - 1;
      const expected = selfClosing ? '/' : '>';
      if (code[offset] === expected) {
        const { line, col } = positionAt(starts, node.start);
        const owner = names.at(-1) || fileFallback || identifierName(node.name);
        splices.push({
          offset,
          text:
            ` data-insp-file=${encodedFile}` +
            ` data-insp-line="${line}"` +
            ` data-insp-col="${col}"` +
            ` data-insp-comp=${jsxAttrValue(owner)}`,
        });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (isAstNode(value)) {
        visit(value);
      }
    }

    if (pushed) names.pop();
  };

  visit(parsed.program);
  if (splices.length === 0) return null;

  splices.sort((a, b) => b.offset - a.offset);
  let output = code;
  for (const splice of splices) {
    output = `${output.slice(0, splice.offset)}${splice.text}${output.slice(splice.offset)}`;
  }
  return output;
}

export function componentInspector(options?: ComponentInspectorOptions): Plugin {
  const enabled = options?.enabled ?? true;

  return {
    name: 'vite-plugin-component-inspector',
    apply: 'serve',
    enforce: 'pre',
    transform: {
      filter: { id: JSX_SOURCE_PATTERN },
      handler(code, id) {
        if (!enabled) return null;
        const transformed = transformComponentInspector(code, id);
        return transformed === null ? null : { code: transformed, map: null };
      },
    },
    transformIndexHtml() {
      if (!enabled) return;
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: CLIENT_ENTRY },
          injectTo: 'body',
        },
      ];
    },
    configureServer(server: ViteDevServer) {
      if (!enabled) return;

      const handler: Connect.NextHandleFunction = (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const file = url.searchParams.get('file');
        const line = url.searchParams.get('line') || '1';
        const col = url.searchParams.get('col') || '1';
        const editor =
          url.searchParams.get('editor') ||
          process.env.INSPECTOR_EDITOR ||
          process.env.EDITOR ||
          'cursor';

        if (file) {
          void openInEditor(editor, file, line, col);
        }
        response.statusCode = 200;
        response.end('ok');
      };

      server.middlewares.use('/__open_in_editor', handler);
      server.middlewares.use('/__open_in_cursor', handler);
    },
  };
}
