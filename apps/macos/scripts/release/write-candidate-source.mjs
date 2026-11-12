// GitHub's PR run/job head_sha is the branch head, while checkout builds GITHUB_SHA (the
// tested merge commit). Preserve both identities in the immutable candidate archive.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== process.env.GITHUB_SHA)
  throw new Error('Candidate checkout differs from GITHUB_SHA.');
const pr = process.env.GITHUB_EVENT_NAME === 'pull_request' ? event.pull_request : null;
if (pr && pr.head.repo.full_name !== process.env.GITHUB_REPOSITORY)
  throw new Error('A fork cannot produce a signed release candidate.');

const source = {
  schemaVersion: 1,
  repository: process.env.GITHUB_REPOSITORY,
  runId: process.env.GITHUB_RUN_ID,
  attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  event: process.env.GITHUB_EVENT_NAME,
  commit,
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  headSha: pr?.head.sha ?? commit,
  pullRequest: pr?.number ?? 0,
  baseSha: pr?.base.sha ?? null,
};
writeFileSync('dist/candidate-source.json', `${JSON.stringify(source, null, 2)}\n`);
