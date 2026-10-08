# Release download mirror

The website and root README use one permanent URL:

<https://downloads.atd.best/latest/Atd-arm64.dmg>

Every successful stable release updates this object to the newest verified Apple silicon DMG.
It downloads as `Atd-<version>-arm64.dmg`, the release asset's own name, so the saved file names
its version while the link never changes.
Cloudflare R2 Standard serves the bytes through the custom domain. GitHub Releases remains the
source of truth and the alternative download location. This does not change Sparkle's signed
appcast or require a new application version.

## Publication

`.github/workflows/release.yml` calls `mirror-release.yml` after publishing a stable release.
The reusable workflow serializes mirror uploads. `mirror.mjs` rejects older releases, downloads
the official versioned asset, and compares its SHA-256 with GitHub's asset digest.

The official AWS CLI performs multipart S3 uploads; the current DMG exceeds Wrangler's
single-object upload limit. A versioned object is uploaded with a one-year immutable cache policy.
Its public size, MIME type, cache headers, byte ranges, and full SHA-256 must pass before a
server-side copy promotes it to the permanent URL. `latest.json` records the verified version,
digest, size, and versioned URL. The permanent URL and manifest use a 60-second cache lifetime,
so a cached previous release can remain visible for up to one minute after promotion.

A failed upload or verification does not promote the candidate. The previous verified download
remains available. A failure after promotion is visible in Actions and can be retried. Manually
rerun **Mirror release downloads** on `main` with `tag: latest` to bootstrap the mirror or recover
from a failed upload. An explicit tag must still equal GitHub's latest stable release.

```sh
# Inspect the current release without credentials or writes.
node ops/release-downloads/mirror.mjs --tag latest --dry-run

# Publish using the repository's encrypted credentials.
gh workflow run mirror-release.yml --repo JUNERDD/ai --ref main -f tag=latest
```

## Private configuration

Create the `atd-releases` bucket with Standard storage, connect `downloads.atd.best`, and keep
the managed `r2.dev` endpoint disabled. Add a Cache Rule matching only
`http.host eq "downloads.atd.best"`: eligible for cache, with Edge TTL and Browser TTL both
respecting the origin's cache headers. The zone's default Browser Cache TTL can otherwise turn
the latest object's 60 seconds into four hours; the mirror's header check catches this.

Configure an R2 API token with **Object Read & Write** restricted to this bucket. Store only
the following GitHub Actions repository secrets:

| Secret                          | Value                                      |
| ------------------------------- | ------------------------------------------ |
| `R2_DOWNLOAD_ACCOUNT_ID`        | The bucket's Cloudflare account ID         |
| `R2_DOWNLOAD_ACCESS_KEY_ID`     | The dedicated token's S3 access key ID     |
| `R2_DOWNLOAD_SECRET_ACCESS_KEY` | The dedicated token's S3 secret access key |

Never commit account IDs or credentials, place them in `VITE_*`, or print them in build logs.
The website only needs the public download URL. CI credentials cannot configure domains, change
other buckets, or deploy Workers.

## Costs and delivery

R2 has no Internet egress fee. Storage and operations share the account's
[R2 free allowance](https://developers.cloudflare.com/r2/pricing/); they can incur charges above it.
The custom domain enables CDN caching, with a
[512 MB object cache limit on Free, Pro, and Business](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).
The mirror refuses larger files so a growing installer cannot silently bypass that cache limit.
Regional throughput depends on the user's network and is not guaranteed.

The [R2 budget guard](../r2-budget-guard/README.md) covers both website media and release downloads.
It can pause their public endpoints before shared thresholds are reached, but is not a billing
hard cap. The GitHub alternative remains available during a pause. After successful promotion,
the mirror keeps the current and two most recently uploaded previous versioned DMGs, plus the
permanent latest object. Older mirror DMGs are removed; GitHub retains the full release archive.
