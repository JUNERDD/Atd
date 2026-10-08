import { readFileSync } from 'node:fs';

// Public documentation keeps aliases and node IDs; file URLs stay on each contributor's machine.
const reference = /^(project|uiKit)(?:\/(\d+[:-]\d+))?$/.exec(process.argv[2] ?? '');
if (!reference || process.argv.length !== 3) {
  console.error('Usage: pnpm design:link <project|uiKit>[/node-id]');
  process.exit(1);
}

try {
  const context = JSON.parse(
    readFileSync(new URL('../.local/project-context.json', import.meta.url), 'utf8'),
  );
  const url = new URL(context.figma[reference[1]]);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.figma.com' ||
    !/^\/design\/[A-Za-z0-9]+(?:\/|$)/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('Invalid Figma file URL');
  }
  url.search = '';
  url.hash = '';
  if (reference[2]) url.searchParams.set('node-id', reference[2].replace(':', '-'));
  console.log(url.href);
} catch {
  console.error(
    'Configure the requested Figma alias in .local/project-context.json. See SECURITY.md.',
  );
  process.exit(1);
}
