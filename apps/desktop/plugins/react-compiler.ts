import { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

/**
 * React Compiler memoizes the renderer's components and hooks, including the shared UI sources the
 * desktop configs bundle. The include must be a regex (a glob matches nothing under Rolldown, and
 * the compiler then silently skips everything) limited to TS sources so Babel never parses CSS or
 * JSON. The preset keeps its own filter (files that mention a component or hook) and applies only
 * to the client environment. Shared by the app build and the test config, so tests exercise the
 * compiled code that ships; the dev server skips it (see vite.config.ts).
 */
export function reactCompiler() {
  return babel({
    presets: [reactCompilerPreset()],
    include: [/\/apps\/desktop\/src\/.*\.tsx?$/, /\/packages\/ui\/src\/.*\.tsx?$/],
  });
}
