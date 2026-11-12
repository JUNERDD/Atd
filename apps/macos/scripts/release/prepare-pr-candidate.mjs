// Build signed candidates only for same-repository version bumps targeting main.
// The integration branch also exercises promotion without changing the product version.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
if (
  process.env.GITHUB_EVENT_NAME !== 'pull_request' ||
  pr?.head?.repo?.full_name !== process.env.GITHUB_REPOSITORY ||
  pr?.base?.repo?.full_name !== process.env.GITHUB_REPOSITORY ||
  pr.base.ref !== 'main' ||
  !/^[0-9a-f]{40}$/.test(pr.base.sha)
)
  throw new Error('Signed candidates require a same-repository PR targeting main.');

const { version } = JSON.parse(readFileSync('apps/macos/package.json', 'utf8'));
const previous = JSON.parse(
  execFileSync('git', ['show', `${pr.base.sha}:apps/macos/package.json`], { encoding: 'utf8' }),
).version;
const enabled = version !== previous || pr.head.ref === 'ci/release-candidate-reuse';
if (!enabled) {
  appendFileSync(process.env.GITHUB_OUTPUT, 'enabled=false\n');
} else {
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
}
