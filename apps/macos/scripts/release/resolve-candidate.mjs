// Selects an immutable artifact from a successful Release candidate at the exact commit and
// version being promoted. A successful workflow alone is insufficient: both native builds,
// DMG jobs, macOS 15 checks and the Intel smoke checks must have actually passed.
//
// node resolve-candidate.mjs --repo <owner/repo> --run-id <id> --commit <sha> --version <v>
// `gh` owns authentication. CI receives the selected ID and digest through GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

function fail(message) {
  throw new Error(`Release candidate: ${message}`);
}

function api(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
}

function list(endpoint, field) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const response = api(
      `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    if (!Array.isArray(response[field])) fail(`GitHub returned no ${field} list.`);
    items.push(...response[field]);
    if (response[field].length < 100) return items;
  }
}

function checkJob(jobs, name, commit, steps) {
  // A partial rerun may reuse an earlier successful build. Check the latest execution of each
  // required job; never accept an old success over a newer failure or skipped verification.
  const job = jobs
    .filter((item) => item.name === name)
    .sort((a, b) => b.run_attempt - a.run_attempt || b.id - a.id)[0];
  if (!job || job.head_sha !== commit || job.status !== 'completed' || job.conclusion !== 'success')
    fail(`${name} did not succeed at ${commit}.`);
  for (const name of steps) {
    const step = job.steps?.find((item) => item.name === name);
    if (step?.status !== 'completed' || step.conclusion !== 'success')
      fail(`${job.name}: ${name} did not run successfully.`);
  }
  return { id: job.id, name: job.name, attempt: job.run_attempt };
}

function resolveCandidate() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      'run-id': { type: 'string' },
      commit: { type: 'string' },
      version: { type: 'string' },
    },
    strict: true,
  });
  const { repo, commit, version } = values;
  const runId = values['run-id'];
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('--repo must be owner/repo.');
  if (!runId || !/^[1-9]\d*$/.test(runId) || !Number.isSafeInteger(Number(runId)))
    fail('--run-id must be a positive integer.');
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) fail('--commit must be a full SHA-1.');
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    fail('--version must be semver.');

  const base = `repos/${repo}/actions/runs/${runId}`;
  const run = api(base);
  if (
    run.repository?.full_name?.toLowerCase() !== repo.toLowerCase() ||
    !Number.isSafeInteger(run.repository?.id) ||
    run.head_repository?.id !== run.repository.id ||
    run.path !== '.github/workflows/release.yml' ||
    run.event !== 'workflow_dispatch'
  )
    fail('Source must be a manual Release workflow run in this repository.');
  if (run.status !== 'completed' || run.conclusion !== 'success')
    fail(`Run ${runId} has not completed successfully.`);
  if (run.head_sha !== commit)
    fail(`Run ${runId} built ${run.head_sha}, not the requested commit ${commit}.`);

  const jobs = list(`${base}/jobs?filter=all`, 'jobs');
  const checks = [];
  for (const arch of ['arm64', 'x64']) {
    checks.push(
      checkJob(jobs, `Release ${arch} / Build ${arch} ${version}`, commit, [
        'Build the Release app',
        'Check the built app',
        "Check the add-ons against the app's lock",
      ]),
      checkJob(jobs, `Release ${arch} / Package ${arch} DMG`, commit, ['Package the dmg']),
      checkJob(jobs, `Release ${arch} / Verify ${arch} on macOS 15`, commit, [
        "Check the dmg's digest",
        'Verify the app',
        'Verify the add-ons',
        ...(arch === 'x64'
          ? [
              'Test Intel Release startup and core functions',
              'Confirm smoke tests preserved the bundle signature',
            ]
          : []),
      ]),
    );
  }
  checks.push(
    checkJob(jobs, `Sign the update feeds for ${version}`, commit, [
      'Write and check the update feeds',
    ]),
  );

  const matches = list(`${base}/artifacts`, 'artifacts').filter(
    (item) => item.name === `Atd-${version}`,
  );
  if (matches.length !== 1)
    fail(`Expected exactly one Atd-${version} artifact, found ${matches.length}.`);
  const artifact = matches[0];
  if (
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0 ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== Number(runId) ||
    artifact.workflow_run.head_sha !== commit ||
    artifact.workflow_run.repository_id !== run.repository.id ||
    artifact.workflow_run.head_repository_id !== run.repository.id ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '')
  )
    fail('Artifact is expired, has no SHA-256 digest, or belongs to another source.');

  const result = {
    runId,
    artifactId: artifact.id,
    digest: artifact.digest,
    commit,
    version,
    checks,
  };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `run-id=${runId}\nartifact-id=${artifact.id}\ndigest=${artifact.digest}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Candidate [run ${runId}](https://github.com/${repo}/actions/runs/${runId}) passed all required checks at \`${commit}\`.\n\n` +
        `Selected immutable artifact \`${artifact.id}\`, \`${artifact.digest}\`.\n`,
    );
  }
  console.log(JSON.stringify(result, null, 2));
}

try {
  resolveCandidate();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
