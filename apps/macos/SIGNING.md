# Developer ID signing and notarization

All checkouts on one Mac read `~/Library/Application Support/Atd Signing/config.json`.
It contains certificate and profile references only. Private keys stay in Keychain, the
encrypted `.p12` backup stays outside Git, and notarization credentials use `notarytool`'s
Keychain storage. No shell-profile or `.env` changes are needed.

## Set up a Mac

1. Import the backed-up `.p12` into a dedicated keychain in Keychain Access. Enter the
   export password, then unlock that keychain. A `.cer` alone lacks the private key.
2. Find the identity with `security find-identity -v -p codesigning`. Use its exact SHA-1
   fingerprint, since an old certificate may have the same display name.
3. From either checkout, configure the identity and its Team ID:

   ```sh
   pnpm --filter @atd/macos signing:setup \
     --identity <certificate-sha1> --team-id <team-id> \
     --keychain "$HOME/Library/Keychains/Atd Signing.keychain-db"
   ```

4. Generate an [Apple app-specific password](https://support.apple.com/102654), then run:

   ```sh
   pnpm --filter @atd/macos signing:setup --credentials --apple-id <apple-account-email>
   pnpm --filter @atd/macos signing:check
   ```

   Enter that password at the hidden terminal prompt. This is separate from both the Mac
   login password and the `.p12` export password. macOS may also ask for the dedicated
   keychain password. Do not put passwords in command-line examples or source files.

The same setup applies after changing Macs: restore the `.p12`, configure the new local
keychain path, and store the notarization credentials again. Syncing the encrypted backup
in iCloud Drive does not automatically install its signing identity on the new Mac.

`AI_CODE_SIGN_IDENTITY`, `AI_DEVELOPMENT_TEAM`, `AI_SIGNING_KEYCHAIN`, `AI_NOTARY_PROFILE`
and `AI_NOTARY_KEYCHAIN` override the local configuration for a process. CI ignores the local
file. `AI_SIGNING_CONFIG` selects an alternate configuration file. A missing or expired
configured identity fails instead of silently selecting a different certificate.

## Build and distribute

- `pnpm dev` / `pnpm --filter @atd/macos build`: uses the shared Developer ID identity when
  configured. Debug builds keep their separate bundle ID and never submit for notarization.
- `pnpm --filter @atd/macos build:release`: builds and signs every nested Mach-O and code
  bundle, then signs the enclosing app with secure timestamps and hardened runtime.
- `pnpm --filter @atd/macos dist:release`: additionally notarizes and staples the app, packages
  the DMG, signs/notarizes/staples it, assesses it with Gatekeeper, then writes its SHA-256.
  Install the existing hash-pinned `dmg/requirements.txt` into a Python virtual environment
  and set `DMG_PYTHON` to that environment's Python before packaging, as CI does.

The Node process needs JIT and loads native plugins, so only it receives `allow-jit` and
`disable-library-validation`. The shell receives audio-input permission for screen-recording
audio. Existing extension/Sparkle sandbox entitlements are retained; `get-task-allow` is
removed from Release code. Signing never weakens the app's designated requirement.

Unsigned CI packaging rehearsals must explicitly use `AI_CODE_SIGN_IDENTITY=-`; they cannot
run the distribution command. `--dry-run` on `build.mjs` prints Xcode arguments only, without
validating credentials or signing anything. Direct Xcode builds do not load the shared JSON;
use the project scripts or supply the signing environment explicitly.

Apple submissions save an artifact digest, submission ID and status in `.notary.json` next
to the submitted archive. If Apple takes longer than `AI_NOTARY_TIMEOUT` (default `30m`),
rerun `node apps/macos/scripts/signing/distribute.mjs` with the same `--app` and `--out`
arguments, without rebuilding. It reuses the archive and DMG under the app signature’s
`DerivedData/notarization/<CDHash>/` directory. The final output directory receives only a
verified installer and checksum. You can also resume an individual exact submission:

```sh
pnpm --filter @atd/macos notarize <submitted.zip> <Atd.app>
pnpm --filter @atd/macos notarize <submitted.dmg>
```

If the dedicated keychain auto-locks during a long build or Apple queue, unlock it in
Keychain Access and rerun the distribution command without rebuilding. The saved submission
is reused; its password does not need to be stored in the checkout or a shell profile.

Changed artifacts cannot reuse an old receipt. Rejections save Apple's diagnostic log. App
ZIPs/receipts live under `DerivedData/notarization`; never publish them as installers.

## GitHub Actions

Both release architectures use an ephemeral keychain, removed by an `always()` cleanup step.
The release workflow requires these repository secrets and variables:

| Kind            | Name                        | Content                                     |
| --------------- | --------------------------- | ------------------------------------------- |
| Secret          | `DEVELOPER_ID_P12`          | Base64 of the encrypted Developer ID `.p12` |
| Secret          | `DEVELOPER_ID_P12_PASSWORD` | Its export password                         |
| Secret          | `NOTARY_APPLE_ID`           | Apple Account email                         |
| Secret          | `NOTARY_APP_PASSWORD`       | Apple app-specific password                 |
| Variable        | `DEVELOPER_ID_SHA1`         | Exact certificate fingerprint               |
| Variable        | `APPLE_TEAM_ID`             | Its team                                    |
| Existing secret | `SPARKLE_ED_PRIVATE_KEY`    | Preserve the existing update key            |

With `gh` authenticated to the intended repository, the setup command can validate the
credentials and upload the new values through stdin, without printing them:

```sh
pnpm --filter @atd/macos signing:setup --credentials --apple-id <apple-account-email> \
  --p12 <encrypted-backup.p12> --github <owner/repository>
```

This sends the signing archive, export password and notarization credentials to that
repository's GitHub Actions secret store. It leaves `SPARKLE_ED_PRIVATE_KEY` and the legacy
`RELEASE_SIGNING_*` secrets untouched. Running setup does not commit, push, publish or start CI.

Query an existing CI submission through GitHub Actions rather than the Mac's Keychain:

```sh
gh workflow run release.yml --repo JUNERDD/Atd --ref <workflow-branch> \
  -f mode=notarization-status -f notarization_submission_id=<submission-uuid>
```

Choose the branch containing this workflow mode (`main` after it merges, or the release branch
during preparation). The read-only job uses the existing Apple Account secrets and Team ID,
without importing the signing certificate or opening a local keychain. Its log and job summary
report the submission's status, artifact name and creation time. It neither builds an app nor
submits, retries or publishes an artifact, and runs independently of long release builds.
Cloud releases and their status queries do not require the local signing keychain to be unlocked;
local builds and distribution still use the Mac setup above.

## Existing users upgrading to 0.11

The update archive remains authorized by the same EdDSA key shipped in 0.10.x. The signing
migration preserves `com.junerdd.ai`, the app name, `AgentService` data directory, service ID,
credential namespaces, URL scheme, macOS 15 minimum and the arm64/x64 appcasts. The legacy
GitHub `appcast.xml` asset also continues to serve older clients. No data reset, reinstallation
or intermediate release is required by the signature transition.

`signing/upgrade-compat.mjs` checks the bundle's public compatibility values before packaging;
`release/feeds.mjs` verifies final DMG signatures against the installed users' pinned key as
well as the new bundles. Sparkle signatures and lengths are generated **after** stapling.
Candidate promotion requires the successful notarization/packaging step, so an earlier
self-signed candidate cannot pass the new gate.

macOS privacy grants are a separate trust boundary: switching from the old self-signed
certificate can require Accessibility/Screen Recording approval once. `StaleGrantRecovery`
already detects a changed designated requirement and recovers lost grants without clearing
app data. Keychain may also ask permission for the newly signed Node process to read existing
credentials; the credential names are preserved and an access failure must not be treated as
an empty credential store. Never reset the user's login keychain to work around this.

Before publishing 0.11, use a version/build newer than 0.10.x, retain the stable update key,
and perform an actual old-client update on both architectures, including existing data,
provider connections, widgets, Finder integration and privacy reauthorization. This live
upgrade check is separate from static/configuration validation and requires an explicitly
authorized app launch. Do not claim it passed solely because notarization succeeded.

References: [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
[Sparkle signing and key rotation](https://sparkle-project.org/documentation/#rotating-signing-keys).
