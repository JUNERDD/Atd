// Find the latest CI for the PR that introduced this release commit. A candidate miss keeps
// the normal build path; an unsuccessful run or an invalid existing candidate stops promotion.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

function api(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
}

function list(endpoint, field) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const response = api(
      `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    const batch = field ? response[field] : response;
    if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid candidate list.');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function miss(reason) {
  const message = `No reusable PR candidate: ${reason}. Running the normal full build.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

function discover() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      commit: { type: 'string' },
      version: { type: 'string' },
      mode: { type: 'string' },
      pr: { type: 'string', default: '' },
    },
    strict: true,
  });
  const { repo, commit, version, mode } = values;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(commit ?? ''))
    throw new Error('Discovery requires owner/repo and a full commit SHA.');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? ''))
    throw new Error('Discovery requires a semver version.');
  if (!['release', 'rehearsal'].includes(mode)) throw new Error('Invalid promotion mode.');
  if (values.pr && (mode !== 'rehearsal' || !/^[1-9]\d*$/.test(values.pr)))
    throw new Error('An automatic PR hint is supported only for a rehearsal.');

  const base = `repos/${repo}`;
  let prs = values.pr
    ? [api(`${base}/pulls/${values.pr}`)]
    : list(`${base}/commits/${commit}/pulls`);
  // GitHub does not associate a temporary PR merge SHA with commits/:sha/pulls. Rehearsal
  // can discover that exact open merge ref; formal publication only accepts a merged PR.
  if (!prs.length && mode === 'rehearsal')
    prs = list(`${base}/pulls?state=open&base=main`).filter((pr) => pr.merge_commit_sha === commit);
  prs = prs.filter(
    (pr) =>
      pr.head?.repo?.full_name === repo &&
      pr.base?.repo?.full_name === repo &&
      pr.base.ref === 'main' &&
      (values.pr || pr.merge_commit_sha === commit) &&
      (mode === 'rehearsal' || pr.merged_at),
  );
  if (!prs.length) {
    if (values.pr) throw new Error('The requested PR is not an eligible candidate source.');
    return miss('no same-repository PR introduced this release commit');
  }
  if (prs.length !== 1) throw new Error('More than one PR identifies this release commit.');
  const pr = prs[0];
  const runs = list(
    `${base}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}`,
    'workflow_runs',
  ).filter((run) => run.head_branch === pr.head.ref);
  const run = runs.sort((a, b) => b.id - a.id)[0];
  if (!run) return miss(`PR #${pr.number} has no CI run for its current head`);
  // Do not select an older green run over a newer failed or unfinished execution.
  if (run.status !== 'completed' || run.conclusion !== 'success')
    throw new Error(
      `Latest PR CI ${run.id} has not completed successfully; finish its checks first.`,
    );
  const artifacts = list(`${base}/actions/runs/${run.id}/artifacts`, 'artifacts');
  const candidate = artifacts.filter((item) => item.name === `Atd-${version}`);
  if (!candidate.length) return miss(`PR CI ${run.id} has no candidate for ${version}`);
  if (candidate.length === 1 && candidate[0].expired)
    return miss(`PR CI ${run.id}'s candidate has expired`);

  console.log(`Automatically selected PR #${pr.number}, CI ${run.id}; verifying its candidate.`);
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('./resolve-candidate.mjs', import.meta.url)),
      '--repo',
      repo,
      '--run-id',
      String(run.id),
      '--commit',
      commit,
      '--version',
      version,
      '--pr',
      String(pr.number),
      '--mode',
      mode,
    ],
    { stdio: 'inherit' },
  );
}

try {
  discover();
} catch (error) {
  console.error(`Candidate discovery: ${error.message}`);
  process.exitCode = 1;
}
