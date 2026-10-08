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

/** @param {Request} request @param {ReturnType<typeof publicEndpoints>} endpoints */
export async function publicAccessState(request, endpoints) {
  const custom = await Promise.all(
    endpoints.map(async ({ custom }) => enabled(await request(custom))),
  );
  const managed = await Promise.all(
    endpoints.map(async ({ managed }) => enabled(await request(managed))),
  );
  return { allPaused: custom.every((value) => !value), managedEnabled: managed.some(Boolean) };
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
