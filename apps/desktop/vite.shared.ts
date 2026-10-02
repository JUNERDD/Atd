import react from '@vitejs/plugin-react';
import { defaultClientConditions, type PluginOption, type UserConfig } from 'vite';

/**
 * React Compiler (the Rust port, `oxc-transform-react`) memoizes the renderer's components and
 * hooks, including the shared UI sources both configs bundle. The include is limited to those two
 * source trees so the compiler never sees dependencies. The app, the dev server and the tests all
 * use it, so tests exercise the compiled code that ships.
 */
export function reactPlugin(): PluginOption {
  return react({
    compiler: true,
    include: [/apps\/desktop\/src\/.*\.tsx?$/, /packages\/ui\/src\/.*\.tsx?$/],
  });
}

/**
 * The workspace packages export `dist` to Node and `src` under the custom `source` condition.
 * The renderer and its tests resolve `source`, so they bundle the TypeScript source and a new
 * export needs no separate package build first; the agent service never sets the condition.
 */
export const workspaceResolve: NonNullable<UserConfig['resolve']> = {
  conditions: [...defaultClientConditions, 'source'],
};
