import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { renderHead } from './src/head.ts';

/**
 * The dev server serves the template unrendered, so it fills the head marker with the English head;
 * production pages get theirs from the prerender step.
 */
function devHead(): Plugin {
  return {
    name: 'atd-dev-head',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace('<!--app-head-->', renderHead('en', 'http://127.0.0.1:5180')),
  };
}

/**
 * A static site: `vite build` makes the client bundle and the template, the SSR build and
 * `scripts/prerender.ts` then write one prerendered page per language into `dist`.
 */
export default defineConfig({
  plugins: [react(), devHead()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
});
