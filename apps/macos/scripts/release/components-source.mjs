// From a clean release checkout after selecting Xcode, pnpm/Node and XcodeGen (native) or
// the pinned Rust toolchain (service):
//   RELEASE_ARCH=arm64 VERSION=1.2.3 BUILD_VERSION=1.2.3 node components-source.mjs native --key-only
// --key-only [--tree <Git tree-ish>] prints the key without Actions or credentials. Discovery
// uses the hosted runner's event/context and gh (contents:read, actions:read). Only cold jobs
// upload. Partial reruns exclude their own artifacts and cold uploads replace their prior ID.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { componentKey, localSourceHash, sourceHash } from './component-key.mjs';

const env = process.env;
const sha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const id = (value) => Number.isSafeInteger(value) && value > 0;
const succeeded = (item) => item?.status === 'completed' && item.conclusion === 'success';
const branchEvents = ['push', 'workflow_dispatch'];
const callerPaths = ['.github/workflows/ci.yml', '.github/workflows/release.yml'];

function api(path) {
  return JSON.parse(
    execFileSync('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 ** 2,
    }),
  );
}

function list(path, field) {
  const items = [];
  for (let page = 1; ; page++) {
    const batch = api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)[field];
    if (!Array.isArray(batch)) throw new Error(`Invalid GitHub ${field} list.`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function sameRepository(run, repoId) {
  return (
    run.repository?.id === repoId &&
    run.head_repository?.id === repoId &&
    run.repository.full_name === env.GITHUB_REPOSITORY &&
    run.head_repository.full_name === env.GITHUB_REPOSITORY
  );
}

function currentRun() {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const repoId = Number(env.GITHUB_REPOSITORY_ID);
  const runId = Number(env.GITHUB_RUN_ID);
  if (
    !id(repoId) ||
    !id(runId) ||
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') ||
    !sha(env.GITHUB_SHA) ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== env.GITHUB_SHA
  )
    throw new Error('Missing Actions identity or checkout differs from GITHUB_SHA.');
  const run = api(`actions/runs/${runId}`);
  if (
    run.id !== runId ||
    !sameRepository(run, repoId) ||
    !callerPaths.includes(run.path) ||
    run.event !== env.GITHUB_EVENT_NAME ||
    !id(run.workflow_id) ||
    !id(run.run_number)
  )
    throw new Error('Component discovery requires a trusted release or CI workflow.');
  if (run.event === 'pull_request') {
    const pr = event.pull_request;
    if (
      !id(pr?.number) ||
      env.GITHUB_REF !== `refs/pull/${pr.number}/merge` ||
      pr.head?.repo?.id !== repoId ||
      pr.base?.repo?.id !== repoId ||
      pr.head.ref !== run.head_branch ||
      !sha(pr.head.sha) ||
      pr.head.sha !== run.head_sha
    )
      throw new Error('The current run must check out a same-repository PR merge.');
  } else if (
    !branchEvents.includes(run.event) ||
    env.GITHUB_REF !== `refs/heads/${run.head_branch}` ||
    env.GITHUB_SHA !== run.head_sha
  ) {
    throw new Error('Component discovery requires a branch push, dispatch, or trusted PR.');
  }
  return run;
}

// GitHub records the SHA and ref of the local reusable workflow. For PRs this identifies
// the checked-out merge, even after the API's pull_requests array becomes empty.
function producerCommit(run) {
  const workflow = `${env.GITHUB_REPOSITORY}/.github/workflows/release-component.yml@`;
  const refs = run.referenced_workflows?.filter((item) => item.path.startsWith(workflow)) ?? [];
  if (refs.length !== 1 || !sha(refs[0].sha) || refs[0].path !== workflow + refs[0].sha)
    throw new Error(`Run ${run.id} has no unique local component workflow revision.`);
  const ref = refs[0];
  if (
    run.event === 'pull_request' &&
    /^refs\/pull\/[1-9]\d*\/merge$/.test(ref.ref) &&
    ref.ref !== env.GITHUB_REF
  )
    return null;
  if (ref.ref !== env.GITHUB_REF || (run.event !== 'pull_request' && ref.sha !== run.head_sha))
    throw new Error(`Run ${run.id} used a different component workflow ref or commit.`);
  return ref.sha;
}

function verifyProducerTree(run, commit, kind, source) {
  const gitCommit = api(`git/commits/${commit}`);
  if (
    gitCommit.sha !== commit ||
    !sha(gitCommit.tree?.sha) ||
    (run.event === 'pull_request' &&
      (gitCommit.parents?.length !== 2 || gitCommit.parents[1].sha !== run.head_sha))
  )
    throw new Error(`Run ${run.id} does not identify the tested checkout.`);
  const tree = api(`git/trees/${gitCommit.tree.sha}?recursive=1`);
  if (
    tree.truncated !== false ||
    tree.sha !== gitCommit.tree.sha ||
    !Array.isArray(tree.tree) ||
    sourceHash(kind, tree.tree) !== source
  )
    throw new Error(`Run ${run.id} has different component source inputs.`);
}

function verifyUpload(run, artifact, kind, arch) {
  const label = kind === 'native' ? 'Native' : 'Service';
  const suffix = `${arch} / ${label} / Prepare ${kind} component`;
  const jobs = list(`actions/runs/${run.id}/jobs?filter=all`, 'jobs').filter(
    (job) => job.name === suffix || job.name.endsWith(` / ${suffix}`),
  );
  const latest = Math.max(...jobs.map((job) => job.run_attempt));
  const matches = jobs.filter((job) => job.run_attempt === latest);
  if (matches.length !== 1 || !id(latest) || latest > run.run_attempt || !succeeded(matches[0]))
    throw new Error(`No unique successful ${suffix} job in run ${run.id}.`);

  // A warm rerun can retain an earlier attempt's upload. Match its immutable ID to the
  // successful step recorded on that attempt. Artifact and runner timestamps have distinct clocks.
  const uploadName = `Upload ${kind} component`;
  const uploadSteps = (job) => job.steps?.filter((step) => step.name === uploadName) ?? [];
  const proofName = `Record uploaded artifact ${artifact.id}`;
  const producers = jobs.filter((job) =>
    job.steps?.some((step) => step.name === proofName && succeeded(step)),
  );
  // GitHub copies successful jobs into partial retries, including their complete step timeline.
  // Copies have fresh job IDs and attempt numbers but describe one actual runner execution.
  const job = producers.includes(matches[0]) ? matches[0] : producers[0];
  const latestUpload = uploadSteps(matches[0]);
  if (
    !succeeded(job) ||
    !id(job.runner_id) ||
    job.steps.filter((step) => step.name.startsWith('Record uploaded artifact ')).length !== 1 ||
    !producers.every(
      (row) =>
        row.run_id === job.run_id &&
        row.head_sha === job.head_sha &&
        row.runner_id === job.runner_id &&
        row.started_at === job.started_at &&
        row.completed_at === job.completed_at &&
        succeeded(row) &&
        isDeepStrictEqual(row.steps, job.steps),
    ) ||
    !id(job.run_attempt) ||
    (job !== matches[0] &&
      (latestUpload.length !== 1 || latestUpload[0].conclusion !== 'skipped')) ||
    job.run_id !== run.id ||
    job.head_sha !== run.head_sha ||
    !job.labels?.includes(arch === 'arm64' ? 'macos-26' : 'macos-26-intel')
  )
    throw new Error(
      `Artifact ${artifact.id} does not identify a successful cold upload in run ${run.id}.`,
    );
  const build =
    kind === 'native' ? 'Compile the native shell' : 'Build the service, Node and add-ons';
  for (const name of [build, 'Archive the component', uploadName]) {
    const steps = job.steps?.filter((step) => step.name === name);
    if (steps?.length !== 1 || !succeeded(steps[0]))
      throw new Error(`Run ${run.id}: ${name} did not succeed.`);
  }
}

function discover(kind, key, source) {
  const current = currentRun();
  const name = `atd-component-${kind}-${env.RELEASE_ARCH}-${key}`;
  const candidates = new Map();
  for (const artifact of list(`actions/artifacts?name=${name}`, 'artifacts')) {
    if (
      artifact.name !== name ||
      artifact.expired === true ||
      Date.parse(artifact.expires_at) <= Date.now()
    )
      continue;
    const runId = artifact.workflow_run?.id;
    if (!id(runId)) throw new Error(`Live ${name} lacks its source run.`);
    if (runId >= current.id) continue;
    if (!candidates.has(runId)) candidates.set(runId, []);
    candidates.get(runId).push(artifact);
  }
  for (const runId of [...candidates.keys()].sort((a, b) => b - a)) {
    const run = api(`actions/runs/${runId}`);
    if (run.id !== runId) throw new Error('Unexpected GitHub workflow run identity.');
    if (
      !sameRepository(run, current.repository.id) ||
      run.workflow_id !== current.workflow_id ||
      run.path !== current.path ||
      run.head_branch !== current.head_branch ||
      !succeeded(run) ||
      run.run_number >= current.run_number ||
      (current.event === 'pull_request'
        ? run.event !== 'pull_request'
        : !branchEvents.includes(run.event))
    )
      continue;
    const commit = producerCommit(run);
    if (!commit) continue;
    const matches = candidates.get(runId);
    const [artifact] = matches;
    const owner = artifact.workflow_run;
    if (
      matches.length !== 1 ||
      !id(artifact.id) ||
      !id(artifact.size_in_bytes) ||
      artifact.expired !== false ||
      !Number.isFinite(Date.parse(artifact.expires_at)) ||
      !/^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '') ||
      !sha(run.head_sha) ||
      !id(run.run_number) ||
      !id(run.run_attempt) ||
      owner.head_sha !== run.head_sha ||
      owner.head_branch !== current.head_branch ||
      owner.repository_id !== current.repository.id ||
      owner.head_repository_id !== current.repository.id
    )
      throw new Error(`Ambiguous, expired or invalid ${name} in run ${runId}.`);
    verifyUpload(run, artifact, kind, env.RELEASE_ARCH);
    verifyProducerTree(run, commit, kind, source);
    return {
      'run-id': runId,
      'artifact-id': artifact.id,
      digest: artifact.digest,
      'source-sha': commit,
    };
  }
  return { 'run-id': '', 'artifact-id': '', digest: '', 'source-sha': '' };
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'key-only': { type: 'boolean' }, tree: { type: 'string' } },
  });
  const [kind] = positionals;
  if (
    positionals.length !== 1 ||
    !['native', 'service'].includes(kind) ||
    (values.tree && (!values['key-only'] || values.tree.startsWith('-')))
  )
    throw new Error(
      'Usage: components-source.mjs <native|service> [--key-only [--tree <tree-ish>]]',
    );
  const source = localSourceHash(kind, values.tree ?? 'HEAD');
  const key = componentKey(kind, source, !values['key-only']);
  if (values['key-only']) console.log(key);
  else {
    const outputs = { key, ...discover(kind, key, source) };
    const lines = Object.entries(outputs)
      .map(([name, value]) => `${name}=${value}\n`)
      .join('');
    appendFileSync(env.GITHUB_OUTPUT, lines);
    console.log(
      `${kind}/${env.RELEASE_ARCH} ${key}: ${outputs['artifact-id'] ? `reuse artifact ${outputs['artifact-id']}` : 'cold build'}`,
    );
  }
} catch (error) {
  console.error(`Release component: ${error.message}`);
  process.exitCode = 1;
}
