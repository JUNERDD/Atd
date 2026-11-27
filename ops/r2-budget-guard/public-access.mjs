// @ts-check

/** @typedef {{bucket: string, domain: string}} Target */
/** @typedef {ReturnType<typeof import('./api.mjs').createRequest>} Request */

/** All configured targets share the account allowance but have separate public entry points.
 * @param {string} account @param {Target[]} targets
 */
export function publicEndpoints(account, targets) {
  if (!Array.isArray(targets) || targets.length === 0)
    throw new Error('At least one public R2 target is required');
  const domains = new Set();
  const buckets = new Set();
  return targets.map(({ bucket, domain }) => {
    if (!bucket || !domain || domains.has(domain) || buckets.has(bucket))
      throw new Error('Invalid or repeated public R2 target');
    domains.add(domain);
    buckets.add(bucket);
    const path = `/accounts/${encodeURIComponent(account)}/r2/buckets/${encodeURIComponent(bucket)}`;
    return {
      custom: `${path}/domains/custom/${encodeURIComponent(domain)}`,
      managed: `${path}/domains/managed`,
    };
  });
}

/** @param {unknown} response */
function enabled(response) {
  if (!response || typeof response !== 'object' || !('result' in response))
    throw new Error('Invalid public endpoint response');
  const result = response.result;
  if (
    !result ||
    typeof result !== 'object' ||
    !('enabled' in result) ||
    typeof result.enabled !== 'boolean'
  )
    throw new Error('Invalid public endpoint state');
  return result.enabled;
}

/**
 * Reads all configured custom and managed endpoints, distinguishing a genuine
 * read error on an active or manually reopened bucket from a read error while
 * previously paused.
 * @param {Request} request @param {ReturnType<typeof publicEndpoints>} endpoints
 */
export async function publicAccessState(request, endpoints) {
  const customChecks = await Promise.allSettled(
    endpoints.map(async ({ custom }) => enabled(await request(custom))),
  );
  const anyCustomEnabled = customChecks.some(
    (result) => result.status === 'fulfilled' && result.value === true,
  );
  const customFailure = customChecks.find((result) => result.status === 'rejected');
  if (customFailure) {
    return {
      ok: /** @type {const} */ (false),
      error: customFailure.reason,
      anyCustomEnabled,
    };
  }
  const allPaused = customChecks.every((result) => result.status === 'fulfilled' && !result.value);
  const managedChecks = await Promise.allSettled(
    endpoints.map(async ({ managed }) => enabled(await request(managed))),
  );
  const managedFailure = managedChecks.find((result) => result.status === 'rejected');
  if (managedFailure) {
    return {
      ok: /** @type {const} */ (false),
      error: managedFailure.reason,
      anyCustomEnabled,
    };
  }
  return {
    ok: /** @type {const} */ (true),
    allPaused,
    managedEnabled: managedChecks.some(
      (result) => result.status === 'fulfilled' && result.value === true,
    ),
  };
}

/** Attempts every endpoint even when one fails; success requires reading all states back.
 * @param {Request} request @param {ReturnType<typeof publicEndpoints>} endpoints
 */
export async function disablePublicAccess(request, endpoints) {
  const paths = endpoints.flatMap(({ custom, managed }) => [custom, managed]);
  const changes = await Promise.allSettled(
    paths.map((path) => request(path, 'PUT', { enabled: false })),
  );
  const checks = await Promise.allSettled(paths.map(async (path) => enabled(await request(path))));
  return {
    disabled: checks.every((result) => result.status === 'fulfilled' && !result.value),
    changeFailures: changes.filter((result) => result.status === 'rejected').length,
  };
}
