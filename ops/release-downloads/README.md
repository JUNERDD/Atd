# Release download mirror

The website and root README use one permanent URL per architecture:

| Architecture            | Permanent download                                | Update feed                                  |
| ----------------------- | ------------------------------------------------- | -------------------------------------------- |
| Apple silicon (`arm64`) | <https://downloads.atd.best/latest/Atd-arm64.dmg> | <https://downloads.atd.best/appcast.xml>     |
| Intel (`x64`)           | <https://downloads.atd.best/latest/Atd-x64.dmg>   | <https://downloads.atd.best/appcast-x64.xml> |

Every successful stable release updates each permanent object to that architecture's newest
verified DMG. It downloads as `Atd-<version>-<arch>.dmg`, the release asset's own name, so the
saved file names its version while the link never changes. Cloudflare R2 Standard serves the
bytes through the custom domain. GitHub Releases remains the source of truth and the alternative
download location.

Installed Release builds also update from this domain. A build's `SUFeedURL` names its own
architecture's feed: `appcast.xml` for arm64, `appcast-x64.xml` for x64. The mirror republishes
each of the release's signed feeds with its enclosure pointing at the verified versioned DMG of
the same architecture; Sparkle's EdDSA signature covers the DMG's bytes, not its URL, so the
release job's signature still applies. The GitHub copy of `appcast.xml` keeps the GitHub URL for
installs built before this feed moved (0.4.0–0.7.9); they take one more update from GitHub and
read the mirror afterwards. `appcast-x64.xml` has no such older readers.

An x64 build running under Rosetta on Apple silicon reads the arm64 feed instead (`AppUpdater`
routes it through `AtdArm64FeedURL`), so a mistaken Intel install returns to the native build on
its next update.

## Add-ons

Optional parts of the app, such as the computer-use browser worker, are not in the DMG. The app
downloads them on demand as add-on archives that its own lock pins: each build embeds
`addons.lock.json` in its service pack, listing every archive's SHA-256, size and URLs
(`packages/agent-contracts/src/addons.ts`, packed by `apps/macos/scripts/addons/pack.mjs`). The
first URL is this mirror's, content-addressed by the archive's SHA-256; the second is the GitHub
release asset:

| URL                                                                         | Role                                   |
| --------------------------------------------------------------------------- | -------------------------------------- |
| `https://downloads.atd.best/addons/<id>/<sha256>.tar.gz`                    | First choice, one-year immutable cache |
| `…/releases/download/v<app version>/Atd-addon-<id>-<version>-<arch>.tar.gz` | Alternate: the GitHub release asset    |

Each release carries the archives of both architectures and their locks as
`addons-arm64.lock.json` and `addons-x64.lock.json`, byte for byte the locks inside the apps.
Every mirror run, on either channel, reads the release's locks, checks each lock names this
mirror's key first and each archive against its lock and GitHub's digest, and uploads it with
`application/gzip`, the one-year immutable cache policy and the asset's download name. A key that
already holds the same bytes counts as done, so the second channel and reruns upload nothing;
one holding other bytes stops the run. The public object's size, type, cache headers and full
SHA-256 must pass. A release without locks (any release before add-ons) has nothing to upload.

Add-on archives are never removed: an installed app of any version keeps downloading exactly the
archives its own lock pins, and an unchanged archive keeps its key across releases. Cleanup only
matches versioned DMG keys, so it never touches `addons/`.

## Channels

The mirror serves two channels from the same bucket, domain, and cache rule:

| Channel  | Serves                                                            | Permanent downloads                 | Manifest      | Update feeds |
| -------- | ----------------------------------------------------------------- | ----------------------------------- | ------------- | ------------ |
| `stable` | GitHub's latest stable release                                    | `/latest/Atd-arm64.dmg`, `-x64.dmg` | `latest.json` | yes          |
| `rc`     | The newest of that release and every published `-rc.n` prerelease | `/rc/Atd-arm64.dmg`, `-x64.dmg`     | `rc.json`     | no           |

The website's preview downloads link to the `rc` channel. Because the stable release sorts after
every candidate for it, the channel follows the stable release once it catches up, so its links
never go dead between release cycles. It publishes no feeds: installed copies, release candidates
included, read the stable feeds, so a candidate updates itself to the next stable release, not to
a later candidate. Other prereleases (a beta, or a stable release withdrawn as a prerelease) are
never served.

Both channels share the versioned keys under `releases/`, so a channel serving the stable release
reuses the DMGs the stable channel already verified. Each channel cleans up only its own versions:
stable `releases/v<x.y.z>/…` keys or candidate `releases/v<x.y.z>-rc.<n>/…` keys.

## Publication

`.github/workflows/release.yml` calls `mirror-release.yml` for the stable channel after publishing
a stable release from `main`, then for the `rc` channel after every publish, including a
release candidate published from a `release/` branch. The reusable workflow serializes mirror
uploads across channels, and moves the stable channel only from `main`. The stages below describe
the stable channel; the `rc` channel runs the same ones without the feeds, writing `rc.json`. `mirror.mjs` rejects older releases, downloads
the official versioned assets of every architecture the release has, and compares each DMG's
SHA-256 with GitHub's asset digest. Each feed must name exactly one update, its own
architecture's versioned DMG, with that DMG's size and the release's version. A release with
x64 assets must also follow the 0.9.0 entry rules: arm64 items require arm64 hardware, both feeds
declare a minimum macOS version, and the x64 feed never declares macOS 27 or later. Older
releases with only arm64 assets and no such entries are accepted, so a rollback can mirror them.

R2 has no multi-object transaction, so a run moves forward in an order where every public state
is valid and a rerun recovers from any stop:

1. Validate both DMGs and feeds, then upload each versioned DMG and verify it. A versioned key
   that already holds the same SHA-256 counts as done and is not uploaded again; one holding
   other bytes stops the run, because its one-year immutable copies may sit in caches. The
   release's add-on archives follow under the same rule (README: Add-ons).
2. Recheck that GitHub's latest release is still the one being mirrored.
3. Advance arm64, then x64: a server-side copy promotes the verified versioned DMG to the
   permanent URL, and once that passes, the feed moves to the same versioned DMG. A failure
   between them can leave the architectures briefly on different versions, but each feed only
   ever names a verified DMG of its own architecture.
4. Write `latest.json`, then remove older versioned DMGs.

When the latest release has no x64 assets (any release before 0.9.0, or after a rollback to one),
the x64 step deletes `/latest/Atd-x64.dmg` and publishes an x64 feed with no items, so a
withdrawn Intel build is no longer offered.

The official AWS CLI performs multipart S3 uploads; the current DMG exceeds Wrangler's
single-object upload limit. A versioned object is uploaded with a one-year immutable cache policy.
Its public size, MIME type, cache headers, byte ranges, and full SHA-256 must pass before it is
promoted. Every permanent object, feed, and `latest.json` is read back after it is written; a
withdrawn permanent object must answer 404. The permanent URLs, feeds, and `latest.json` use a
60-second cache lifetime, so a cached previous release can remain visible for up to one minute.

`latest.json` keeps its original top-level fields with their arm64 meaning (`version`, `sha256`,
`bytes`, `url` of the versioned DMG) and adds `architectures`, keyed by `arm64` and `x64`, each
with `version`, `sha256`, `bytes`, `url`, `latest`, and `feed`. An architecture the latest
release lacks has no entry.

Uploads and server-side copies use the AWS CLI's
[standard retry mode](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-retries.html)
with up to three total attempts per request. Public reads (the DMG, feed, and manifest checks,
and the check for an already uploaded versioned DMG) also try each request up to three times on
request/body timeouts or HTTP 502, 503, and 504. They share the
[HTTP retry timing policy](../../scripts/http-retry.mjs) with the website asset checks: random
backoff of 0–1 seconds before the second attempt and 0–2 seconds before the third. A valid
`Retry-After` (integer seconds or an HTTP date) sets a minimum wait, with jitter added within a
30-second per-wait limit. A server minimum above that limit stops the request with an explicit
error instead of retrying early; missing, invalid, or expired values use random backoff alone.
Each attempt keeps a 30-second timeout for headers, byte ranges, feeds, and `latest.json`, or
five minutes for a full DMG download. A full-download retry restarts the stream and SHA-256
calculation. Missing files, invalid headers, changed bytes, and mismatched feed content still
fail immediately. Retry logs identify the object, method, and byte range when present.

A failed upload or verification does not promote the candidate. The previous verified download
remains available. A failure after promotion is visible in Actions and can be retried. Manually
rerun **Mirror release downloads** on `main` with `tag: latest` to bootstrap the mirror or recover
from a failed upload. An explicit tag must still equal GitHub's latest stable release.

```sh
# Inspect each channel's current release without credentials or writes.
node ops/release-downloads/mirror.mjs --tag latest --dry-run
node ops/release-downloads/mirror.mjs --channel rc --dry-run

# Publish using the repository's encrypted credentials.
gh workflow run mirror-release.yml --repo JUNERDD/Atd --ref main -f tag=latest
gh workflow run mirror-release.yml --repo JUNERDD/Atd --ref main -f tag=latest -f channel=rc
```

After the mirror finishes, it keeps the two most recently uploaded versioned DMGs of each
architecture, plus any DMG a current feed names, and the permanent objects. Older mirror DMGs
are removed; GitHub retains the full release archive.

## Rehearsal

The same script rehearses against a separate, publicly readable pre-release bucket. The
`artifacts` mode of `release.yml` uploads a flat directory with both DMGs, both feeds,
`manifest.json`, and the add-on archives with both architectures' locks; download it and pass it
as `--source-dir`. Its add-on archives go to `addons/` below `--prefix`; the locks still name the
production mirror, which the rehearsal does not write. A rollback source is assembled the
same way from a 0.8.x release: its arm64 DMG, its `appcast.xml`, and a manifest listing only the
arm64 artifact.

| Flag                   | Effect                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--channel <name>`     | `stable` (the default) or `rc` (README: Channels). `rc` takes no `--tag`: it serves the newest published release.                                                                                                                           |
| `--source-dir <dir>`   | Reads DMGs, feeds, `manifest.json`, and any add-on locks and archives from a directory instead of GitHub, hashing every DMG against the manifest and every archive against its lock. Skips the latest-release recheck. Accepts RC versions. |
| `--bucket <name>`      | The bucket to write. Required, and not the production bucket, with `--source-dir`.                                                                                                                                                          |
| `--base-url <origin>`  | The bucket's public origin for read-back checks and feed URLs. Required, and not production's, with `--source-dir`. Plain HTTP is accepted only for a loopback host.                                                                        |
| `--prefix <path/>`     | Places every key below this prefix. Cleanup lists and removes keys only inside it.                                                                                                                                                          |
| `--stop-after <stage>` | Stops at `after-immutable-upload` (DMGs and add-ons), `before-feed-advance` (arm64's permanent DMG moved, no feed yet), or `between-arches` (arm64 finished, x64 not started).                                                              |

RC keys such as `releases/v0.9.0-rc.3/…` match the cleanup pattern only with `--source-dir`, and
only inside `--prefix`. Without flags the script mirrors to the production bucket, which is how
the workflow calls it. Export the rehearsal bucket's credentials (`R2_DOWNLOAD_ACCOUNT_ID`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) in your own shell; they must only reach the
rehearsal bucket.

```sh
node ops/release-downloads/mirror.mjs --source-dir <download> \
  --bucket <rehearsal-bucket> --base-url <public-origin> --prefix rehearsal/ \
  --stop-after before-feed-advance
```

## Rollback

Roll back only for a serious problem found after a release is published; fix earlier problems on
the release branch.

1. `gh release edit v<bad version> --prerelease`.
2. `gh release edit v<previous version> --latest`, then confirm
   `gh api repos/{owner}/{repo}/releases/latest` returns that version.
3. Manually run **Mirror release downloads** on `main` with `tag: latest`, then again with
   `channel: rc`, so the preview downloads leave the withdrawn release too. The mirror accepts an
   older single-architecture release: the arm64 feed points back at it, and the x64 feed becomes
   empty while `/latest/Atd-x64.dmg` and the x64 entry of `latest.json` are removed. Objects
   already in R2 with the same SHA-256 count as done; older DMGs removed by cleanup are uploaded
   again from GitHub.
4. GitHub's `appcast.xml` for older installs follows `releases/latest` back automatically.
5. Withdraw website download links with a revert pull request.

To withdraw a bad release candidate, turn it back into a draft
(`gh release edit v<candidate> --draft`) and run the mirror with `channel: rc`; the channel moves
to the newest remaining candidate or the stable release.

Some effects cannot be undone. Sparkle never offers a lower version, so clients already on the
withdrawn release stay on it without being stuck; appcast entries clients have already seen
cannot be recalled; and an install on a macOS version the previous release does not support
cannot return to it. Fix these forward with a new release.

## Private configuration

Create the `atd-releases` bucket with Standard storage, connect `downloads.atd.best`, and keep
the managed `r2.dev` endpoint disabled. Add a Cache Rule matching only
`http.host eq "downloads.atd.best"`: eligible for cache, with Edge TTL and Browser TTL both
respecting the origin's cache headers. The zone's default Browser Cache TTL can otherwise turn
the latest objects' 60 seconds into four hours; the mirror's header check catches this.

Configure an R2 API token with **Object Read & Write** restricted to this bucket. Store only
the following GitHub Actions repository secrets:

| Secret                          | Value                                      |
| ------------------------------- | ------------------------------------------ |
| `R2_DOWNLOAD_ACCOUNT_ID`        | The bucket's Cloudflare account ID         |
| `R2_DOWNLOAD_ACCESS_KEY_ID`     | The dedicated token's S3 access key ID     |
| `R2_DOWNLOAD_SECRET_ACCESS_KEY` | The dedicated token's S3 secret access key |

Never commit account IDs or credentials, place them in `VITE_*`, or print them in build logs.
The website only needs the public download URLs. CI credentials cannot configure domains, change
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
hard cap. The GitHub alternative remains available for manual downloads during a pause, but
installed apps cannot check for or download updates until `downloads.atd.best` is re-enabled.
This holds for both architectures: the x64 feed, like the arm64 feed, has no GitHub fallback.
