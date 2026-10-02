# plugin-kit

Install, normalize and resolve agent plugin bundles for any agent harness.

> Working name. The package is `private` until its public name is chosen. License: MIT.

## What it does

- **Normalizes** four bundle layouts into one model:
  [Agent Plugins 1.0](https://agent-plugins.org/specification) (`plugin.json` + `skills/` + `mcp.json`),
  Claude Code plugins (`.claude-plugin/plugin.json`, `skills/`, `agents/`, `commands/`, `.mcp.json`),
  [pi packages](https://github.com/earendil-works/pi) (`package.json` `pi` key) and bare
  [Agent Skills](https://agentskills.io) folders.
- **Installs** from a local path, a git URL (pinned to the resolved commit) or an npm spec
  (verified against the registry's SRI integrity) into immutable, content-addressed revisions.
- **Resolves** host-owned and installed plugins into one catalog with qualified names
  (`<plugin>:<item>`), effective enablement and per-run snapshots.

## Entry points

| Import             | Runtime        | Contents                                                                                      |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------- |
| `plugin-kit`       | any JS runtime | model and TypeBox schemas, names, format adapters over `ReadonlyFs`, substitution, resolution |
| `plugin-kit/model` | any JS runtime | schemas, types and name helpers only (depends on `typebox` alone)                             |
| `plugin-kit/node`  | Node ≥ 22      | `createNodeFs`, `createPluginInstaller` (fetch, staging, registry, state, GC)                 |

## Ports

The host supplies `SecretStore` (sensitive user config), and optionally `Clock` and `Logger`.
Host-owned plugins (built-ins, personal items) are passed to `resolveCatalog` as `HostPlugin`s;
the kit never reads host stores.

## Security model

- Installing never runs code: no npm lifecycle scripts, no git hooks, no hooks from bundles.
- Every path is realpath-checked against the plugin root.
- New plugins land disabled. Whether an MCP server may launch is the host's decision, not the kit's.
- No bundle format defines signing. Integrity is limited to the git commit and the npm tarball
  integrity; the install preview lists executables and URLs for review.
- Imported but never executed: Claude hooks, `bin/`, LSP, output styles, `` !`cmd` `` prompt
  blocks, pi extensions and themes. They are reported as diagnostics.

## Naming

Items of installed plugins are qualified as `<plugin>:<item>` (`installedItemName`), so plugins
cannot shadow each other or the host. A `skill`-format plugin (a bare Agent Skills folder) keeps its
skill's bare name. Nested component paths are flattened with `-` (`commands/db/migrate.md` becomes
`db-migrate`). Hosts find an item's plugin through `pluginId`, never by parsing names.

## Format notes

- **Agent Plugins 1.0**: closed manifest schema; unknown fields are reported and ignored;
  `extensions` namespaces are reported as unsupported. Only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`
  are substituted, in stdio `args`, `env` values and `cwd`.
- **Claude Code**: `$ARGUMENTS[N]` and `$N` are 0-based in Claude's docs and become 1-based argument
  segments. `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}` and
  `${VAR:-default}` are substituted; sensitive config values are redacted from model-visible text.
  In an HTTP `url` or header, a process-environment `${VAR}` stays `${VAR}` (unless its `:-`
  default applies) for the MCP client to fill in when it connects.
- **pi packages**: the `pi` key selects resources exactly as pi does (globs, `!` exclusions);
  prompt templates become commands; extensions and themes are reported as unsupported.

## Fetching

| Source | How                                                                   | Pinned by                 |
| ------ | --------------------------------------------------------------------- | ------------------------- |
| local  | directory copy (no `.git`, `node_modules`)                            | content hash              |
| git    | `isomorphic-git` shallow clone over HTTPS                             | resolved commit           |
| npm    | registry packument + tarball, verified against `dist.integrity` (SRI) | exact version + integrity |

Symlinks that resolve outside the plugin are dropped before publishing. Limits: 50 MiB and 5000
files per bundle by default.

Not supported yet: npm semver ranges (use an exact version or a dist-tag), private registries and
`.npmrc` auth, git credentials and proxies, marketplace catalogs.

## Development

```sh
pnpm --filter @atd/plugin-kit test
pnpm --filter @atd/plugin-kit typecheck   # also checks the pure entry without Node types
pnpm --filter @atd/plugin-kit build
```

## Non-goals

Marketplace catalogs (`marketplace.json`), hooks, code extensions, memory stores.
