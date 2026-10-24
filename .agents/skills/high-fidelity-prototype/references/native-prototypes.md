# Native macOS prototypes

Use this reference when fidelity depends on AppKit or SwiftUI windows, materials, focus, or motion. The source map below is a starting point for inspection, not a frozen API specification. Paths are repository-relative; confirm current owners before reuse.

## Choose the smallest faithful runtime

An isolated product runtime is appropriate when the question depends on the real renderer, bridge, service, permissions, or shell lifecycle. Follow [runtime-debugging](../../runtime-debugging/SKILL.md) for that path; the renderer's dev URL alone cannot reproduce the native app.

A standalone native harness is useful when a self-contained surface or effect can answer the question with local scenario data. It can render real system glass and use product source without booting the product service. When the target is an existing UI, assess the actual component or package with a mocked service boundary and an isolated product run before choosing a recreated surface. New state wiring, mock forms, or simulated frames do not prove production integration.

Before building, identify existing app instances and source watchers without attaching to their sessions. A temporary edit in a watched product source tree can rebuild or restart the user's app even if the new executable has a different name. Prefer a task-owned source snapshot outside watched trees, or an isolated checkout, when this risk applies.

For a standalone harness:

- Use a unique app name and bundle identifier, plus task-owned build and cache paths. Do not overwrite the installed app or the shared development bundle.
- Compile only the source subset and platform frameworks needed for the surface. A small `swiftc` build may suffice; use a package or Xcode target when dependencies or resources require one. Derive language, concurrency, architecture, SDK, and deployment settings from the sources and available toolchain.
- Package a valid `.app`, include required resources, sign as appropriate for local execution, and launch through LaunchServices. Avoid inheriting production startup, singleton, service, or updater behavior merely to display a view.
- Use isolated data and verified free ports if dependencies need them. A local, simulated native surface may need neither a service nor a network port.
- Retain a reproducible build/launch command and identify the exact app instance owned by the task. If a required capability cannot be reproduced safely, report the gap instead of attaching to the user's running app.

Do not run concurrent packaging operations in the product checkout; its release staging has shared paths. See [Commands And Local Runtime](../../../../AGENTS.md#commands-and-local-runtime) for the authoritative isolation and build constraints.

## Inspect existing surface owners

| Concern                                                 | Starting points                                                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native material, base fill, appearance, and active rim  | `apps/macos/Sources/AIShell/Windows/NativeMaterialView.swift`, `GlassSurface.swift`, `ActiveGlassPanel.swift`                                                                                                    |
| Mini Panel dimensions, nonactivating window, and motion | `apps/macos/Sources/AICore/MiniPanel/MiniPanelGeometry.swift`, `MiniPanelChoreography.swift`; `apps/macos/Sources/AIShell/MiniPanel/MiniPanelWindow.swift`, `MiniPanelView.swift`                                |
| Command HUD state and input ownership                   | `apps/macos/Sources/AIShell/Island/IslandController.swift`, `IslandWindow.swift`, `IslandCard.swift`, `IslandComposeCard.swift`, `IslandComposeKeys.swift`; `apps/macos/Sources/AICore/Island/OptionsCard.swift` |
| Mini Panel actions and cross-surface lifecycles          | `apps/macos/Sources/AIShell/App/ShellController+MiniPanel.swift`, `Summoner.swift`; `apps/macos/Sources/AIShell/Selection/CommandProgressController.swift`; `apps/desktop/src/features/agent/light-command.ts`, `light-command-choose.ts`, `light-command-compose.ts` |
| Continuous loading field and lifecycle                  | `apps/macos/Sources/AIShell/Island/IslandGlowField.swift`, `IslandGlowStyle.swift`, `IslandWorkingGlow.swift`, `IslandLoadingGlow.swift`, `IslandHostedPieces.swift`                                             |

Trace dependencies through the owning view and controller before selecting source pieces. Include the affected state, interaction, assets, localization, and lifecycle owners in the source-to-proposal map. For example, the glow field and its style are relatively self-contained, while the full command island depends on models, cards, localization, assets, and lifecycle ownership. `IslandWorkingGlow` also uses `IslandPlainHost`, defined alongside unrelated pieces in `IslandHostedPieces.swift`; a narrowly copied helper can suit an effect study if its origin is recorded. Reusing that helper or the window's geometry and glass does not establish fidelity to the complete Mini Panel or Command HUD.

Reuse or match the actual surface owner. Desktop backdrop blur belongs to the native material; content should not add a second outer border, shadow, or rounding layer. Preserve appearance pinning and fill when those are necessary for readable, stable glass. Read geometry from the correct primitive: the Mini Panel command menu and Command HUD option rows have different inset and radius contracts.

## Establish the existing-surface baseline

For a change to an existing native surface, first run the unchanged owning source in the chosen isolated runtime. Capture its composition at the intended size and exercise the affected interactions before introducing new states. If it cannot run, identify the missing dependency or evidence and assess another reuse boundary; do not describe an unverified recreation as a faithful baseline. A focused component or motion study only needs the source and baseline relevant to that claim.

Preserve the owner's affected interaction chain: pill or capsule to card transitions, edge anchoring and hover, original icons and text, focus handoff, click and drag behavior, tooltips, menus, and scrolling. Check these against the running baseline rather than inferring them from individual source files. Keep their hierarchy and presentation unless the requested design explicitly changes them; a convenient always-open card or added grip is a design change, not harness plumbing.

Confirm that the baseline retains the owner's composition and interactions, then add the scoped proposal and compare again. Record which pieces run unchanged, which use adapters or recreations, and which data or actions are simulated. This makes a real system material, a mocked task, and a replaced controller distinct fidelity claims.

For a Mini Panel integration, trace its actions beyond the native controller into summon, imports, composer, and command launch. The command menu is a launcher; a command run may itself use computer tools. Preserve the distinction between those concepts when adding activity presentation, and link shared runs by explicit identity. Check the current light-command replacement and handover rules rather than assuming every command can run independently or that merely opening the main panel hands a command over.

## Focus is part of fidelity

The current Mini Panel cannot become key or main. The Command HUD allows keyboard focus for its input/card states. Preserve that distinction in a prototype rather than making every floating window activatable for convenience.

Check the intended transitions: passive status updates and nonactivating controls leave the working app's keyboard focus alone; input surfaces can accept typing; dismissal returns focus appropriately; options and text drafts follow their respective deactivation behavior. Explicitly opening a standard monitor or main window follows that window's activation contract. Inspect shortcut and pointer entry paths separately when a command card already owns the keyboard; do not assume their protections are identical. If the standalone harness only approximates a main-panel form, label it accordingly instead of calling it the actual renderer.

Window placement uses display work areas in logical points, including screens with negative origins. Check edge anchoring, available height, and transparent regions as well as content bounds. A transparent hosting view alone is not evidence of correct click-through behavior.

## Loading effect integration example

Inspect the current `IslandLoadingGlow` composition before reusing the field:

- `IslandWorkingGlow(active:)` controls animation activity and retirement; the caller also owns its visible opacity. Setting `active` alone does not implement the complete entry/exit transition.
- The current composition keeps one field through execution and writing, transitions the writing hue, and retains that hue while completion fades. Take durations and phase choices from the current style and requested design, not from historical tuning values.
- Prepare the field before the window first becomes visible when synchronous entrance is required. Mounting it with delayed text presence can make it appear late.
- Preserve motion through the fade, then pause it when hidden, occluded, detached, or reduced-motion behavior requires it. Parameter changes should not reset the accumulated phase unless replay is intentional.

These are integration facts about this effect. They do not require unrelated prototypes to use a glow, the same palette, or the same phase transitions.

## Verify the composed desktop result

Build and inspect the actual `.app`. Use task-owned windows and permitted native tooling for interaction checks; use OS-composited captures for material and window evidence. Page screenshots and a successful compile do not establish native appearance.

For the changed surfaces, cover contrasting or busy backgrounds and focused/unfocused presentation. Inspect four corners, fill, rim, shadow, clipping, text readability, and appearance changes. Compare hierarchy, state transitions, and control behavior with the baseline at the intended size; a successful compile and matching glass do not establish these. Exercise relevant controls, focus handoffs, replay/reset, and interrupted motion. Use reduced motion, reduced transparency, and increased contrast where they affect the feature.

Keep evidence scoped to the prototype and avoid capturing unrelated private content. Report which native behaviors were actually observed, which are only represented by the harness, and any checks that could not run. The repository's [Visual Acceptance](../../../../AGENTS.md#visual-acceptance) remains the completion criterion.
