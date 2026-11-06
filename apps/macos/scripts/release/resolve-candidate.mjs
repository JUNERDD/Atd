// Selects an immutable candidate for the exact version and repository tree being promoted.
// Preserve its tested commit even when GitHub gives the final PR merge a different SHA.
// A successful workflow alone is insufficient: both native builds,
// DMG packaging, macOS 15 checks and the Intel smoke checks must have actually passed.
//
// node resolve-candidate.mjs --repo <owner/repo> --run-id <id> --commit <sha> --version <v>
// PR CI sources also require --pr <number>; --mode release requires that PR to be merged.
// `gh` owns authentication. CI receives the selected ID and digest through GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function sourceIdentity(run, repo, commit, prNumber, mode) {
  if (run.path === '.github/workflows/release.yml' && run.event === 'workflow_dispatch') {
    if (prNumber || run.head_sha !== commit)
      fail('A manual candidate must match the requested commit and have no PR number.');
    return { prefix: 'Build candidate / ', prNumber: 0 };
  }
  if (run.path !== '.github/workflows/ci.yml' || run.event !== 'pull_request')
    fail('Source must be a manual Release candidate or a signed PR CI run.');
  if (!/^[1-9]\d*$/.test(prNumber ?? '') || !Number.isSafeInteger(Number(prNumber)))
    fail('A PR candidate requires --pr with its positive PR number.');
  const pr = api(`repos/${repo}/pulls/${prNumber}`);
  if (
    pr.head?.repo?.id !== run.repository.id ||
    pr.base?.repo?.id !== run.repository.id ||
    pr.base.ref !== 'main' ||
    pr.head.ref !== run.head_branch ||
    pr.head.sha !== run.head_sha
  )
    fail('PR identity or current head differs from the requested source.');
  if (mode === 'release' && (!pr.merged || pr.merge_commit_sha !== commit))
    fail('Formal promotion requires this PR to be merged at the release commit.');
  if (!pr.merged && pr.state !== 'open')
    fail('An unmerged PR candidate can only be rehearsed while its PR remains open.');
  // run/job head_sha identifies the PR branch head. The archive's source receipt and manifest
  // are checked against the actual tested merge commit before any draft is created.
  return { prefix: 'PR release candidate / ', prNumber: Number(prNumber) };
}

function selectArtifact(artifacts, name, run, runId) {
  const matches = artifacts.filter((item) => item.name === name);
  if (matches.length !== 1) fail(`Expected exactly one ${name} artifact, found ${matches.length}.`);
  const artifact = matches[0];
  if (
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0 ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== Number(runId) ||
    artifact.workflow_run.head_sha !== run.head_sha ||
    artifact.workflow_run.repository_id !== run.repository.id ||
    artifact.workflow_run.head_repository_id !== run.repository.id ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '')
  )
    fail(`${name} is expired, has no SHA-256 digest, or belongs to another source.`);
  return artifact;
}

function readReceipt(repo, artifact) {
  const archive = execFileSync(
    'gh',
    ['api', `repos/${repo}/actions/artifacts/${artifact.id}/zip`],
    {
      maxBuffer: 1024 * 1024,
    },
  );
  const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
  if (digest !== artifact.digest) fail('Candidate source receipt archive digest differs.');
  const dir = mkdtempSync(join(tmpdir(), 'atd-candidate-source-'));
  try {
    const path = join(dir, 'source.zip');
    writeFileSync(path, archive);
    const bytes = execFileSync('unzip', ['-p', path, 'candidate-source.json'], {
      maxBuffer: 64 * 1024,
    });
    return {
      data: JSON.parse(bytes.toString('utf8')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkReceipt(receipt, run, runId, source, repo, commit) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.repository !== repo ||
    receipt.runId !== runId ||
    receipt.event !== run.event ||
    receipt.headSha !== run.head_sha ||
    receipt.pullRequest !== source.prNumber ||
    !/^[0-9a-f]{40}$/.test(receipt.commit ?? '') ||
    !/^[0-9a-f]{40}$/.test(receipt.tree ?? '')
  )
    fail('Candidate source receipt does not identify this run and PR.');
  const built = api(`repos/${repo}/git/commits/${receipt.commit}`);
  const target = receipt.commit === commit ? built : api(`repos/${repo}/git/commits/${commit}`);
  if (built.tree?.sha !== receipt.tree || target.tree?.sha !== receipt.tree)
    fail('Release commit and tested candidate have different repository trees.');
  if (source.prNumber) {
    if (
      built.parents?.length !== 2 ||
      built.parents[0].sha !== receipt.baseSha ||
      built.parents[1].sha !== run.head_sha
    )
      fail('Candidate was not built from the recorded PR base and head merge.');
  } else if (receipt.commit !== commit) {
    fail('A manual candidate must match the exact release commit.');
  }
}

function resolveCandidate() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      'run-id': { type: 'string' },
      commit: { type: 'string' },
      version: { type: 'string' },
      pr: { type: 'string', default: '' },
      mode: { type: 'string', default: 'rehearsal' },
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
  if (!['release', 'rehearsal'].includes(values.mode)) fail('--mode must be release or rehearsal.');

  const base = `repos/${repo}/actions/runs/${runId}`;
  const run = api(base);
  if (
    run.repository?.full_name?.toLowerCase() !== repo.toLowerCase() ||
    !Number.isSafeInteger(run.repository?.id) ||
    run.head_repository?.id !== run.repository.id
  )
    fail('Source must belong to this repository, not a fork.');
  if (run.status !== 'completed' || run.conclusion !== 'success')
    fail(`Run ${runId} has not completed successfully.`);
  const source = sourceIdentity(run, repo, commit, values.pr, values.mode);

  const jobs = list(`${base}/jobs?filter=all`, 'jobs');
  const checks = [];
  const check = (name, steps) => checkJob(jobs, name, run.head_sha, steps);
  if (source.prNumber) {
    checks.push(
      check('Detect changed areas', ['Prepare the PR candidate']),
      check('Code quality and production build', ['Run pnpm check']),
      check('macOS desktop smoke test', ['Require the Swift and Rust checks']),
    );
  }
  for (const arch of ['arm64', 'x64']) {
    checks.push(
      check(`${source.prefix}Build ${arch} ${version}`, [
        'Build the Release app',
        'Check the built app',
        "Check the add-ons against the app's lock",
        'Package the dmg',
      ]),
      check(
        `${source.prefix}Verify ${arch} on ${arch === 'arm64' ? 'macos-15' : 'macos-15-intel'}`,
        [
          "Check the dmg's digest",
          'Verify the app',
          'Verify the add-ons',
          ...(arch === 'x64'
            ? [
                'Test Intel Release startup and core functions',
                'Confirm smoke tests preserved the bundle signature',
              ]
            : []),
        ],
      ),
    );
  }
  checks.push(
    check(`${source.prefix}Sign the update feeds for ${version}`, [
      'Write and check the update feeds',
      'Record the candidate source',
      'Upload the candidate source',
    ]),
  );

  const artifacts = list(`${base}/artifacts`, 'artifacts');
  const artifact = selectArtifact(artifacts, `Atd-${version}`, run, runId);
  const receiptArtifact = selectArtifact(artifacts, `Atd-${version}-source`, run, runId);
  const { data: receipt, sha256: receiptSha256 } = readReceipt(repo, receiptArtifact);
  checkReceipt(receipt, run, runId, source, repo, commit);

  const result = {
    runId,
    artifactId: artifact.id,
    digest: artifact.digest,
    commit,
    version,
    headSha: run.head_sha,
    prNumber: source.prNumber,
    event: run.event,
    sourceCommit: receipt.commit,
    tree: receipt.tree,
    receiptArtifactId: receiptArtifact.id,
    receiptSha256,
    checks,
  };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `run-id=${runId}\nartifact-id=${artifact.id}\ndigest=${artifact.digest}\n` +
        `head-sha=${run.head_sha}\npr-number=${source.prNumber}\nevent=${run.event}\n`,
    );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `source-commit=${receipt.commit}\ntree=${receipt.tree}\nreceipt-sha256=${receiptSha256}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Candidate [run ${runId}](https://github.com/${repo}/actions/runs/${runId}) passed all required checks at \`${receipt.commit}\`.\n\n` +
        `Release commit \`${commit}\` has the same complete repository tree \`${receipt.tree}\`.\n\n` +
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
