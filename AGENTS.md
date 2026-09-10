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
- Keep behavior with the module that owns the concept. Decomposition should leave the original module with less responsibility and give the new module a clear purpose with narrow, one-way dependencies. Avoid pass-through modules and generic helper collections created only to reduce line counts.
- Components should handle rendering, composition, and local event wiring; hooks should orchestrate React state and effects. Place independent domain logic in the nearest feature-owned helper when separation improves clarity. Do not extract trivial logic solely to satisfy a directory rule.

## Community Reuse Before Custom Implementation

The goal is to deliver the requested behavior with less custom infrastructure to maintain. This project policy expresses the user's reuse preference; the [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices) informs its explicit decision boundaries, instruction consistency, and proportionate verification.

- Before implementing or delegating a reusable capability such as shortcut recording, key matching, forms, or accessible controls, inspect the relevant feature, shared packages, platform APIs, and installed dependencies, then research suitable community libraries. Research happens before committing to a custom implementation, not after writing one.
- Prefer suitable existing project code, native platform APIs, installed libraries, and maintained community libraries over a new implementation. A library being absent from this repository is not evidence that it is unsuitable; verify availability and compatibility rather than assuming dependencies from another project exist here.
- Use current official documentation and upstream source or releases to check the closest candidates against required behavior, framework and runtime compatibility, release maturity, maintenance, license, and dependency cost. Keep research focused; stop when there is enough evidence to choose a suitable solution or establish a concrete gap.
- Reuse the chosen library's supported APIs and compose existing components. Keep custom code limited to uncovered business rules and necessary integration, such as IPC, persistence, or native accelerator conversion. Do not duplicate a library's event handling, parsing, recording, or state management behind a new wrapper. Product controls should continue to reuse shadcn components from `packages/ui`.
- When proposing custom reusable behavior, state which existing or community solutions were checked, link the relevant evidence, and identify the specific unmet requirement or disproportionate integration cost. Familiarity, imagined flexibility, a failed search, or already-written custom code is not sufficient justification. Trivial business logic and straightforward glue code do not require a separate library or an extended research exercise.
- When delegation is authorized, include the accepted reuse decision and evidence in worker contracts before dispatching dependent implementation. Resolve an uncertain library choice through focused research first. If new evidence changes that choice, coordinate the affected work and remove superseded duplication during integration while preserving unrelated changes.
- Selecting and integrating a suitable dependency is part of authorized implementation, subject to explicit user constraints and repository dependency rules; do not introduce a separate approval gate for routine choices. Verify the actual integration using applicable existing checks, report the reuse decision and any remaining custom boundary, and continue once the required evidence is sufficient. These rules do not authorize unrelated migrations, dependency upgrades, new tests, or runtime launches.

## Electron And Design Boundaries

- Keep native capabilities in the main process. Expose a narrow, typed API through `contextBridge` and the shared Electron contract; do not expose raw `ipcRenderer`, Node.js, or unrestricted filesystem access to the renderer.
- Preserve `contextIsolation`, sandboxing, disabled `nodeIntegration`, sender validation, permission handling, and navigation restrictions. Validate IPC payloads at the main-process boundary.
- Position desktop windows using display work areas in logical pixels; handle negative monitor coordinates and small displays. Keep main-process and preload packaging paths consistent with the Vite build.
- Review `BrowserWindow` options and renderer root styles together when changing window corners, transparency, borders, or shadows. For the macOS floating panel, the native window and material own the outer clipping, edge, shadow, and desktop backdrop; do not duplicate these effects with a CSS window shell.
- Keep `html`, `body`, and `#root` transparent and fill the native content bounds edge to edge. The panel may paint a shared, token-based translucent or opaque content surface when required for readability or the approved design. Native material supplies desktop blur; the renderer controls the content surface color and opacity. Give that fill one owner, avoiding duplicate tint layers in `BrowserWindow.backgroundColor`, root elements, or pseudo-elements. Remove competing outer CSS radii, borders, and shadows; do not use a fill to conceal incorrect clipping or corner seams.
- Scope CSS window shells to browser previews or platform fallbacks without the native material, using the typed desktop bridge for platform detection before the first paint. Do not assume CSS `backdrop-filter` blurs the desktop behind Electron, or copy a Figma radius onto an already rounded native window. Map design effects to their owning layer instead of rendering them twice.
- Reuse `packages/ui` components and design tokens. For Figma work, inspect variables, styles, effects, and existing mappings before introducing literal values or duplicate components.
- By default, synchronize user-requested visual and interaction changes between the canonical project Figma file and application code in the same task. Update shared components, states, tokens, and affected review examples together; verify the previous agreed design values are preserved. The user does not need to repeat this requirement. Respect explicit design-only, code-only, research, or approval-before-implementation requests. If either side cannot be updated, report the unsynchronized scope and reason instead of claiming both are complete.
- Discover cloud Figma tools first. Use the local Figma connection only when cloud access or a required capability is unavailable, or when the user requests local access; verify the target file and node before using a local selection.
- Preserve exact exported design assets in the repository rather than relying on expiring URLs. Represent implemented behavior honestly; do not present local task storage as a connected AI service.

## shadcn Preset Fidelity

- The approved preset is `b27GcrRo`: Radix / Rhea, Neutral base and theme, Inter with inherited heading font, Lucide, default radius, subtle menu accent, and default menu color. The reference command is `pnpm dlx shadcn@latest init --preset b27GcrRo --template vite --monorepo --pointer`; it records the intended setup and does not authorize rerunning initialization or upgrading an existing project.
- Before designing or implementing controls, inspect both `components.json` files, `packages/ui/src/styles.css`, and the relevant checked-in component variants. Use the installed CLI's read-only preset decoding when needed. Match the resolved preset and actual component defaults, not a generic notion of shadcn or a skill's suggested default style.
- Figma components must match the selected Rhea variants in geometry, control height, padding, gaps, typography, fill, border, and supported states. Check token bindings and screenshots as well as component names. A connected Nova, Vega, or other-style library instance does not by itself satisfy the Rhea requirement; matching only the font and color is insufficient.
- Reuse existing project Rhea components, variables, and text styles first. If the approved shared library lacks a matching variant, preserve its instance and icon references and apply the exact code-backed values through project-owned reusable adaptations and tokens. Document the source mapping and any remaining discrepancy; do not detach instances, silently substitute another style, or modify the shared library to resolve a project-specific mismatch.
- Preserve explicitly approved product exceptions, including native window materials, the settings content inset, sidebar transparency, and logo sizing. Scope those exceptions to their owning surface or composition; do not flatten Rhea's rounded controls into Nova-like outlines or override primitive defaults simply to match an inconsistent earlier draft. The `--pointer` preference applies to enabled interactive controls' cursor behavior.
- Before handing a design to implementation, compare representative default, hover, focus, disabled, and selected controls against the current preset sources. Pass the verified variant/token mapping to the implementation owner, and correct affected reusable components and screens together. Do not claim preset fidelity based only on a successful import or a configured `components.json`.

## Figma File Ownership

- The [project Figma file](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai) (`D9YK1tEeBTEBgstcepesW5`) owns application screens, project-specific components, and project-specific styles and variables. The [shared shadcn UI kit](https://www.figma.com/design/tEV8H6Msibbc64Dds5eehO/shadcn-ui-kit-community-edition--Community-) (`tEV8H6Msibbc64Dds5eehO`) is the approved source for shared UI components and Lucide icons. Discover and reuse its assets through the cloud Figma MCP before creating replacements; preserve connections to its main components.
- Reuse `App / Icon button`, `App / Panel header`, and `App / Composer` from [02 · App components](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=69-80), and desktop main components from `00 · Desktop assets`. Compose project-specific components from existing project components and shared-library instances. Inspect the current file structure and references when they disagree with these guidelines; do not recreate obsolete assets to satisfy stale page names.
- Use component instances for reusable controls and compositions; keep layout containers and one-off content as frames. Represent supported appearances and states with variants, copy with text properties, and replaceable icons with instance-swap properties. Expose nested controls where their state or icon needs editing, and use semantic layer names.
- Use auto layout, fill/hug sizing, padding, and gaps to express layout intent. Remove redundant wrappers and empty spacer layers when layout properties serve the same purpose. Reuse existing variables and styles, document component usage alongside the main components, and verify width changes, long text, icon swaps, and state changes after structural edits.
- Shared-library instances, styles, and variables may remain remote. Do not detach, duplicate, or migrate them into the project solely to make references local. Preserve nested dependencies, overrides, text properties, image fills, layout, variable aliases, and modes when adapting designs. Modify the shared library itself only when the user requests library changes; otherwise keep project-specific extensions in the project file.
- After component migrations, audit affected pages and dependent components for broken references, unexpected source libraries, variable aliases, explicit modes, and instance-swap properties. `getMainComponentAsync().remote` is not an error by itself: verify that the reference points to the intended library. Compare screenshots before and after a reference-only migration. Project design links should target the project file; shared-component and icon links should target the shared shadcn file.

## Lucide Icons

- Use Lucide for product UI icons. Import named components directly from `lucide-react` at their usage sites; do not introduce a generic `icon.tsx` wrapper or a name-to-icon registry.
- Reuse `Lucide / <kebab-case-name>` components from the [shared shadcn library's Icons page](https://www.figma.com/design/tEV8H6Msibbc64Dds5eehO/shadcn-ui-kit-community-edition--Community-?node-id=1953-8996). Find components by exact name through the cloud Figma MCP, then import by component key and create or swap connected instances. Existing library icons do not require computer use or rerunning the Lucide plugin.
- The project's former `00 · Icon` page (`14:91`) is obsolete and is not an icon source. Do not recreate or repopulate it. If it still exists, treat it as migration residue; before removing it as part of an authorized cleanup, verify and reconnect any remaining dependents to the shared library.
- If an icon appears missing, first verify the shared library's actual contents and naming aliases; a failed search or unavailable connection does not prove the icon is absent. Use the [official Lucide Icons Figma plugin](https://www.figma.com/community/plugin/939567362549682242/lucide-icons) only for a confirmed missing icon within an authorized library update. Preserve the plugin-imported frame and association in that case. Do not redraw icons or substitute package-rendered SVGs, and do not describe shared-library imports as plugin imports.
- Match the Figma glyph to an export available in the project's pinned `lucide-react` version, checking aliases when names differ (for example, `History` maps to `rotate-ccw-clock`). Keep the 24 × 24 base size, proportional 2px stroke, and existing color-variable bindings consistent with the rendered icon size; verify instance geometry and colors after resizing or swapping.
- Preserve shared-library component references when applying published library updates. Do not claim that Figma library updates or plugin imports automatically track the project's `lucide-react` package version or upstream Lucide releases.

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
