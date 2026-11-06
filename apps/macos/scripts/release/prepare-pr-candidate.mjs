// Opt-in signed candidates stay on the same-repository experiment PR. Ordinary and fork
// pull requests continue to run the existing checks without receiving release credentials.
import { appendFileSync, readFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
if (
  process.env.GITHUB_EVENT_NAME !== 'pull_request' ||
  pr?.head?.repo?.full_name !== process.env.GITHUB_REPOSITORY ||
  pr?.base?.repo?.full_name !== process.env.GITHUB_REPOSITORY ||
  pr.head.ref !== 'ci/release-pipeline-performance' ||
  pr.base.ref !== 'main'
)
  throw new Error('Signed PR candidates are restricted to the same-repository experiment PR.');

const { version } = JSON.parse(readFileSync('apps/macos/package.json', 'utf8'));
const project = readFileSync('apps/macos/project.yml', 'utf8');
const marketing = project.match(/^\s*MARKETING_VERSION:\s*(\S+)/m)?.[1];
const build = version.replaceAll('-', '');
if (
  marketing !== version ||
  !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ||
  !/^\d+\.\d+\.\d+([A-Za-z][0-9A-Za-z]*(\.[0-9A-Za-z]+)*)?$/.test(build)
)
  throw new Error('PR candidate version must match project.yml and sort correctly in Sparkle.');

appendFileSync(
  process.env.GITHUB_OUTPUT,
  `enabled=true\nmarketing-version=${version}\nbuild-version=${build}\n`,
);
