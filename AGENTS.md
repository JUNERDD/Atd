# Repository Guidelines

## Repository Scope And Sources Of Truth

- `pnpm-workspace.yaml` defines workspace membership; the root `package.json` defines the pnpm version and workspace commands. Paths below are repository-relative.
- The Electron application lives in `apps/desktop/`. Its main process and preload live in `apps/desktop/electron/`; the React renderer lives in `apps/desktop/src/`.
- Shared shadcn components and theme tokens belong to `packages/ui/`; shared TypeScript configuration belongs to `packages/typescript-config/`.
- Follow system and developer instructions first. Explicit user instructions in the current conversation override these repository guidelines for the scope they address. Preserve existing authorization without introducing a new approval gate.
- Read applicable nested `AGENTS.md` files before editing their subtrees. Treat source files, package scripts, and repository configuration as the source of truth; avoid copying volatile implementation details into this file.
- Do not use `docs/`, private notes, or Git stashes as task context unless the user requests them. A user-requested plan and its referenced artifacts remain in scope for the task that created or approved them.
- Do not read or search other conversations or task histories without explicit user authorization. Earlier content from the current conversation may be used as needed.

## Task Execution

- Treat implementation and fix requests as authorization to finish the scoped work and applicable checks. Respect requests limited to explanation, review, or planning.
- Resolve routine choices from repository evidence and conversation context. Ask only when a missing decision materially affects correctness, scope, or consequential side effects; continue independent authorized work while waiting.
- Carry existing authorization forward. When further approval is required, first prepare the authorized work into a concrete, reviewable result.
- If a skill causes a pause, approval request, or incomplete work, link to its exact `SKILL.md`, quote the relevant instruction, and explain why it applies. Do not turn a general guideline into an approval gate.
- Incorporate follow-up constraints without losing the original objective or completed work. A status question does not cancel the task.
- Use subagents only when explicitly requested by the user or applicable instructions. Assign bounded work and distinct file ownership; do not overlap edits or disturb another active task.

## Commands And Local Runtime

- Before pnpm-based validation, confirm `pnpm --version` matches the root `packageManager`.
- `pnpm dev` starts the Electron app through Turbo. `pnpm dev:web` starts the renderer preview. Inspect `apps/desktop/vite.config.ts` for the configured host and port; do not invent a different origin.
- `pnpm build` builds the renderer, main process, and preload. `pnpm package` builds and packages the desktop app; inspect the desktop package scripts and `electron-builder.yml` before changing packaging behavior.
- `pnpm test` runs Vitest once; `pnpm --filter @ai/desktop test:watch` watches existing tests. `pnpm test:electron` builds and runs the Electron smoke suite.
- Do not start or restart the Electron app or renderer development server unless the user explicitly asks to start, open, preview, or verify it, or has already authorized that runtime work in the current task.
- Do not attach browser automation, DevTools, or Playwright to a running local app without that authorization. An already-running app does not itself authorize inspection. Do not stop or replace processes owned by another task.

## Code Conventions

- Use TypeScript and functional React. Follow `.oxfmtrc.json`, `.oxlintrc.json`, and the conventions of the nearest feature.
- Every maintained `.ts` and `.tsx` file must have at most **350 lines**, including blank lines and comments. This includes declaration files, tests, configuration files, and checked-in shadcn components. The `max-lines` override in `.oxlintrc.json` enforces this as an error; generated build output remains excluded by the existing ignore patterns.
- Keep the limit after formatting. Do not compress code, remove useful comments, suppress `max-lines`, or add file exclusions merely to pass the limit. Split responsibilities at meaningful boundaries before a file grows beyond it.
- Prefer behavior-preserving simplifications that remove avoidable branches, modes, layers, duplicated ownership, and special cases. Use the simplest implementation that satisfies the requirement.
- Comments should explain non-obvious intent, contracts, ownership, ordering, or failure behavior. Skip comments that restate the code; use JSDoc for exported contracts when names and types do not explain their semantics.
- Fix the owning contract or data flow when addressing a bug. If only a mitigation is safe, identify it and explain the remaining root cause.
- Validate uncertain data at runtime boundaries and express internal invariants in types. Do not use `any`, broad casts, optionality, speculative fallbacks, or retries to hide an unresolved contract.
- Search the relevant feature, shared packages, and existing dependencies before adding an abstraction or package. Explain why the closest existing solution is unsuitable when introducing a replacement.
- Keep behavior with the module that owns the concept. Decomposition should leave the original module with less responsibility and give the new module a clear purpose with narrow, one-way dependencies. Avoid pass-through modules and generic helper collections created only to reduce line counts.
- Components should handle rendering, composition, and local event wiring; hooks should orchestrate React state and effects. Place independent domain logic in the nearest feature-owned helper when separation improves clarity. Do not extract trivial logic solely to satisfy a directory rule.
- Reuse installed libraries where they fit. Do not assume dependencies from another repository exist here or add them for patterns that simple code already handles clearly.

## Electron And Design Boundaries

- Keep native capabilities in the main process. Expose a narrow, typed API through `contextBridge` and the shared Electron contract; do not expose raw `ipcRenderer`, Node.js, or unrestricted filesystem access to the renderer.
- Preserve `contextIsolation`, sandboxing, disabled `nodeIntegration`, sender validation, permission handling, and navigation restrictions. Validate IPC payloads at the main-process boundary.
- Position desktop windows using display work areas in logical pixels; handle negative monitor coordinates and small displays. Keep main-process and preload packaging paths consistent with the Vite build.
- Review `BrowserWindow` options and renderer root styles together when changing window corners, transparency, borders, or shadows. For the macOS floating panel, the native window and material own the outer clipping, edge, shadow, and desktop backdrop; do not duplicate these effects with a CSS window shell.
- When a native material provides the background, keep `html`, `body`, `#root`, and the outer panel transparent and fill the content bounds edge to edge. Remove competing outer CSS radii, borders (including pseudo-elements), shadows, and background overlays that obscure the material. Inner controls and cards may retain their design surfaces; do not hide corner seams by adding an opaque outer fill.
- Scope CSS window shells to browser previews or platform fallbacks without the native material, using the typed desktop bridge for platform detection before the first paint. Do not assume CSS `backdrop-filter` blurs the desktop behind Electron, or copy a Figma radius onto an already rounded native window. Map design effects to their owning layer instead of rendering them twice.
- Reuse `packages/ui` components and design tokens. For Figma work, inspect variables, styles, effects, and existing mappings before introducing literal values or duplicate components.
- Discover cloud Figma tools first. Use the local Figma connection only when cloud access or a required capability is unavailable, or when the user requests local access; verify the target file and node before using a local selection.
- Preserve exact exported design assets in the repository rather than relying on expiring URLs. Represent implemented behavior honestly; do not present local task storage as a connected AI service.

## Figma File Ownership

- Keep reusable components, styles, and variables in the [project Figma file](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=0-1) (`D9YK1tEeBTEBgstcepesW5`) unless the user explicitly requests a shared external library. Reuse `App / Icon button`, `App / Panel header`, and `App / Composer` from [02 · App components](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=69-80), desktop main components from `00 · Desktop assets`, and Lucide main components from `00 · Icon`.
- Use component instances for reusable controls and compositions; keep layout containers and one-off content as frames. Represent supported appearances and states with variants, copy with text properties, and replaceable icons with instance-swap properties. Expose nested controls where their state or icon needs editing, and use semantic layer names.
- Use auto layout, fill/hug sizing, padding, and gaps to express layout intent. Remove redundant wrappers and empty spacer layers when layout properties serve the same purpose. Reuse existing variables and styles, document component usage alongside the main components, and verify width changes, long text, icon swaps, and state changes after structural edits.
- When bringing in external designs, migrate the used main components and their nested dependencies, styles, variable alias chains, and modes into this file before reconnecting instances. Preserve instance overrides, text properties, image fills, layout, and Lucide plugin associations; keep instances connected to local main components.
- Audit every page after component migrations: check `getMainComponentAsync().remote`, referenced styles and variables, variable aliases, explicit modes, and instance-swap properties. Replacing a nested icon alone does not localize its parent button. Compare screenshots before and after a reference-only migration and check repository Figma design links against the canonical file key.

## Lucide Icons

- Use Lucide for product UI icons. Import named components directly from `lucide-react` at their usage sites; do not introduce a generic `icon.tsx` wrapper or a name-to-icon registry.
- Reuse the local `Lucide / <kebab-case-name>` components in [Figma's `00 · Icon` page](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=14-91) (file key `D9YK1tEeBTEBgstcepesW5`, page ID `14:91`). Find components by exact name through the cloud Figma MCP, then create or swap instances. Existing library icons do not require computer use or rerunning the plugin.
- Import missing icons and library updates through the [official Lucide Icons Figma plugin](https://www.figma.com/community/plugin/939567362549682242/lucide-icons). Preserve the imported `lucide/<name>` frame and its plugin association inside the reusable component. Do not substitute package-rendered SVGs, manually drawn paths, or community files for plugin imports, or describe those substitutes as plugin imports.
- Match the Figma glyph to an export available in the project's pinned `lucide-react` version, checking aliases when names differ (for example, `History` maps to `rotate-ccw-clock`). Keep the 24 × 24 base size, proportional 2px stroke, and existing color-variable bindings consistent with the rendered icon size; verify instance geometry and colors after resizing or swapping.
- Treat the imported library as a local snapshot. Preserve existing component references when refreshing it, and do not claim that plugin imports automatically track upstream releases.

## Validation

- Use relevant static checks as the default completion bar; runtime work remains subject to Commands And Local Runtime.
- For changes to native window surfaces, authorized visual verification must include the actual OS-composited Electron window against contrasting backgrounds. Inspect all four corners, edge fill, duplicate outlines, shadow, and the visible native material. Browser previews and renderer-only screenshots do not verify desktop composition; if native inspection was not performed, explicitly report that limitation instead of claiming the native appearance is verified.
- `pnpm lint` runs workspace Oxlint checks, including the 350-line limit. For a scoped read-only check, use `pnpm exec oxlint <changed-files>`; do not use `--fix` on unrelated files.
- `pnpm typecheck` checks evaluated TypeScript, imports, exported contracts, and build configuration. Oxlint does not replace type checking. Skip type checking for Markdown-only or lint-configuration-only changes that do not alter evaluated application code, and state the reason.
- Format only task-owned files with `pnpm exec oxfmt <changed-files>`, then inspect the result. `pnpm format:check` checks repository formatting; do not run a repository-wide formatting write over unrelated work.
- Do not create or plan new tests unless the user explicitly requests tests or a test plan. Run existing relevant tests when applicable; keep config validation proportionate to the change.
- Once applicable checks pass, repeat or broaden them only for new edits, failures, or unresolved concerns. Review the task-owned diff and remaining requirements before finishing.
- Report failures and unrun checks accurately. Do not claim that a build, runtime check, package, or remote push succeeded without evidence.

## Safety And Protected Content

- Never commit secrets, credentials, local task data, or private environment values. Do not modify `.env*` or machine-wide environment settings without an explicit request.
- Treat existing worktree changes as user-owned. Do not revert, reformat, stage, or commit unrelated changes, including changes owned by another active task.
- Do not remove TypeScript or lint suppression directives unless the scoped task requires it and the affected code has been validated. Use active rule IDs from the repository configuration when adjusting a suppression.
- Preserve dependency versions and the lockfile unless dependency changes are in scope. Do not install packages or change package-manager configuration merely to perform an unrelated check.

## Communication And Handoff

- Use the user's language and lead with the outcome. Keep progress updates brief and concrete; prefer plain prose and use lists when they improve clarity.
- State what changed, relevant validation results or reasons for skipping checks, and remaining blockers. Link to affected files and distinguish observations from assumptions.
- Commit messages use Conventional Commits: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, or `chore`. Do not assume commit hooks are installed; inspect repository configuration.
- Commit or push only within the user's authorized scope. Keep each commit focused and preserve other tasks' work.
