# Design entry for agents

Use this file to find the smallest relevant design context. Product implementation lives in the repository; Figma expresses design intent and finite examples. A component link is not evidence that every state has shipped.

## Start here

1. Resolve the private `project` and `uiKit` aliases from `.local/project-context.json`; `pnpm design:link project` opens the project file. Keep resolved file URLs and keys out of tracked files.
2. Read the project's **00 · Start here · Agent index** (`project/2875:170634`; start at `project/2875:170635`), or the local [design index](docs/design/README.md). The local [manifest](docs/design/manifest.json) provides node IDs, domains, source owners, replacement links, and evidence limits.
3. Choose one feature domain and one screen or main component. Use metadata to narrow large containers; once the source node is known, read its design context, variables, or screenshot directly as needed. Do not dump the entire product or component page.
4. Read the component's implementation resource and current properties. Follow its main component, nested instances, variable aliases, explicit modes, and slot ownership. Preserve project and shared-library connections.
5. Compare the relevant source and agreed requirements. Report conflicts explicitly; do not turn prototype fixtures, old descriptions, or a missing drawing into a new product requirement.

The design index and snapshots under `docs/design/` are Git-ignored project context. If absent on another checkout, inspect the live Figma index and regenerate scoped metadata; do not treat the missing local snapshot as a missing design.

## Sources and roles

| Source                    | Role                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `project/1:251`           | Product flows, feature examples, QA, and prototype states; read the individual section's role. |
| `project/69:80`           | Project main components, adaptations, and component review examples.                           |
| `project/0:1`             | Desktop backdrops and reference assets; these are not product controls.                        |
| `uiKit/1953:8996`         | Approved shared Lucide icon sources.                                                           |
| `packages/ui/`            | Checked-in Rhea components and semantic theme tokens.                                          |
| `apps/desktop/src/`       | React rendering, interactions, localized copy, and client behavior.                            |
| `apps/macos/Sources/`     | Native windows, materials, capture, selection toolbar, island, and widgets.                    |
| `apps/agent-service/src/` | Service capabilities, validation, persistence, execution, and failure behavior.                |

Names prefixed `Legacy /` identify retained sources with replacements. `Prototype /`, `Fixture /`, and `Z` identify finite demo data or internal prototype machinery. `Q`, `QA`, and `Review` identify bounded acceptance examples. Website exports have their own styling and are not desktop UI references.

## Implementation rules

- Reuse the main composition that owns layout and behavior, not only its icons. Read variant axes and text/boolean/swap properties from the actual node.
- Preserve Rhea preset `b27GcrRo`, Inter, semantic tokens, and connected Lucide sources. Refer to the applicable `AGENTS.md` for native material and responsive requirements.
- Keep Figma variant names separate from runtime APIs. Hover/focus/disabled variants are visual states; Figma prototype timers and sample values are not backend contracts.
- Resolve settings navigation through `settings-sections.ts` and `settings-window.tsx`. The shared layouts explicitly cover sidebar, top navigation, and drawer; resizing does not automatically switch a Figma variant.
- Check both locales in the renderer's locale resources. User data, model IDs, provider names, and agent output are not translated by the UI layer.
- Treat `.description` and Dev Mode resource links as human-readable implementation references. They do not imply that published Code Connect templates exist.

## Maintaining the index

Preserve node IDs and prototype destinations during organization. Add new feature sources to the live index and local manifest, and label a replaced source with its replacement IDs. Keep dated implementation records in [design-source.md](docs/design-source.md); read them as history and scope evidence, not a single current specification.

For a structure-only change, verify node identities, ownership, source paths, component counts, and prototype starts. For visual or interaction changes, also apply the repository's visual acceptance and isolated runtime requirements.

The structure follows Figma's [official MCP guidance](https://developers.figma.com/docs/figma-mcp-server/structure-figma-file/): semantic names, reusable components, variables, layout intent, annotations, and implementation resources.
