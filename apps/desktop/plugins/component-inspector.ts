import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NodePath, PluginObj } from '@babel/core';
import type { Connect, Plugin, ViteDevServer } from 'vite';

export interface ComponentInspectorOptions {
  enabled?: boolean;
}

interface BabelApi {
  types: typeof import('@babel/core').types;
}

interface EditorLaunch {
  executable: string;
  args: string[];
}

const CLIENT_ENTRY = '/src/dev/component-inspector/index.ts';

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

/**
 * Tags every JSX opening element with the source location and owning component
 * so the dev-only client inspector can resolve a DOM node back to its file.
 */
export function componentInspectorBabelPlugin({ types: t }: BabelApi): PluginObj {
  return {
    visitor: {
      JSXOpeningElement(path, state) {
        const filename = state.file.opts.filename;
        if (!filename || !filename.includes('/src/')) return;
        const loc = path.node.loc;
        if (!loc) return;

        let comp = '';
        let current: NodePath | null = path.parentPath;
        while (current) {
          if (
            (current.isFunctionDeclaration() || current.isFunctionExpression()) &&
            current.node.id
          ) {
            comp = current.node.id.name;
            break;
          }
          if (current.isVariableDeclarator() && t.isIdentifier(current.node.id)) {
            comp = current.node.id.name;
            break;
          }
          current = current.parentPath;
        }

        if (!comp) {
          const base =
            filename
              .split('/')
              .pop()
              ?.replace(/\.[^.]+$/, '') ?? '';
          if (/^[A-Z]/.test(base)) {
            comp = base;
          }
        }

        // The transform can see already-instrumented code on a re-transform.
        // Never emit a second set of attributes for the same element.
        const alreadyTagged = path.node.attributes.some(
          (attribute) =>
            t.isJSXAttribute(attribute) &&
            t.isJSXIdentifier(attribute.name, { name: 'data-insp-file' }),
        );
        if (alreadyTagged) return;

        const tagName = t.isJSXIdentifier(path.node.name) ? path.node.name.name : '';

        path.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('data-insp-file'), t.stringLiteral(filename)),
          t.jsxAttribute(
            t.jsxIdentifier('data-insp-line'),
            t.stringLiteral(String(loc.start.line)),
          ),
          t.jsxAttribute(
            t.jsxIdentifier('data-insp-col'),
            t.stringLiteral(String(loc.start.column + 1)),
          ),
          t.jsxAttribute(t.jsxIdentifier('data-insp-comp'), t.stringLiteral(comp || tagName)),
        );
      },
    },
  };
}

export function componentInspector(options?: ComponentInspectorOptions): Plugin {
  const enabled = options?.enabled ?? true;

  return {
    name: 'vite-plugin-component-inspector',
    apply: 'serve',
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
