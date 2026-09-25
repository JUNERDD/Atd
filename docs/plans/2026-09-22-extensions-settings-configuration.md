# Extensions settings configuration

Status: Research complete — implementation not requested
Created: 2026-09-22
Approval: Planning only. Implementation is not authorized.

## Summary

The Extensions settings page (`拓展`) lists skills, roles, and MCP servers and does not configure them. Search is disabled while the catalog is empty. Each group shows a note and either a loading line, an empty line, or a read-only title/description row. There is no install, add, enable, edit, remove, or connect action.

This plan records how community coding harnesses let a person configure the same three kinds of extension, then turns that into a settings interaction that fits decisions this product already made. It does not implement the page.

Observed page behavior, from `ServiceSettings`:

- Data comes from `useServiceSkills`, `useServiceRoles`, and `useServiceMcp` after the service reports `connected`.
- Rows are filtered by a local query. With a zero catalog, the search field stays disabled.
- Copy already states timing: skill selection freezes when a turn is accepted; skill, role, and MCP edits apply on the next turn; MCP config is not hot-swapped.

Accepted local map: the page is a connected read-only catalog. The service and a narrow desktop bridge already implement install, MCP connect, and MCP auth. Role edits, skill updates, MCP server configuration, and MCP revoke exist on the service but are not on the desktop bridge. No skill-uninstall route was found.

Accepted Pi map (`v0.85.1` and pi-hermes-memory `v0.9.8`): skills and packages are files plus `pi install` / `pi config` / `/reload`. Pi has no built-in MCP settings and no built-in subagent settings. Hermes manages its own procedural skills through `skill_manage` and `/memory-skills`, separate from hand-installed Pi skills.

Accepted community map: Claude Code, Codex, OpenCode, Goose, Cline, and Cursor all put add, enable, and remove on a settings or command surface. The shared pattern that fits this product is a durable catalog for later runs. Mid-session toggles, project files, and `/reload` do not.

## Clarifying Questions

- [x] Is this pass planning and research only? Yes. The request is to investigate community harness configuration interactions and record a plan. No settings UI is to be built in this pass.
- [x] Which configuration jobs belong on this page versus a task composer or a file? This page owns the service-profile catalog. The task composer owns which of those entries a run uses, frozen at accept. User-written project files are not the configuration home. See Recommendation.

## File And Code References

- `apps/desktop/src/features/service/service-settings.tsx` — Extensions page. Read-only groups only.
- `apps/desktop/src/features/settings/settings-window.tsx` — settings tab `extensions`.
- `apps/desktop/src/i18n/locales/zh-CN/settings.json` — `extensions` and `service` copy, including empty states and next-turn notes.
- `docs/plans/2026-09-20-pi-subagent-skills-mcp.md` — no project entity; service user profile owns skills and roles; freeze the selection when a run is accepted; configuration writes the next version and does not hot-swap the active tool set.
- `apps/desktop/electron/service/ipc.ts` — renderer bridge includes `skillsInstall`, `mcpConnect`, `mcpAuthStart`, and `mcpAuthComplete`. It does not include role save, skill update, MCP configure, or MCP revoke.
- `apps/agent-service/src/skills/routes.ts` — `installSkill`, `updateSkill`, `putRoleHandler`. No uninstall route.
- `apps/agent-service/src/mcp/routes.ts` — `handleMcpConfigure` adds, replaces, or disables servers.
- `packages/agent-client/src/skills-client.ts` — `listSkills` and `installSkill` only.
- `packages/agent-client/src/mcp-client.ts` — `mcpConfigure` and `mcpRevoke` exist for service clients, not for the Extensions page.
- `${referenceRoot}/pi/packages/coding-agent/README.md` — “No MCP.” and “No sub-agents.”
- `${referenceRoot}/pi/packages/coding-agent/docs/packages.md` — `pi config` toggles extensions, skills, prompts, and themes; Tab switches global and project settings.
- `${referenceRoot}/pi/packages/coding-agent/docs/usage.md` — `/reload` reloads skills and extensions.
- `${referenceRoot}/pi-hermes-memory/README.md` — `/memory-skills` searches, moves, and deletes Hermes skills; `skill_manage` creates them during work.

## Pi And Hermes

Pi’s configuration home is files and a terminal, not a desktop settings window.

- Skills are directories with `SKILL.md`, discovered from user and project paths. `pi config` writes enable and disable patterns into `~/.pi/agent/settings.json` or `.pi/settings.json`. A running session picks that up through `/reload`.
- Packages use `pi install`, `pi remove`, `pi list`, and `pi update`. Project packages load only after the project is trusted.
- `/settings` changes runtime preferences such as whether `/skill:name` commands are registered. It is not the inventory of installed skills.
- Built-in MCP configuration is absent. Built-in subagent or role settings are absent. The subagent example is an optional extension that reads markdown agent files.
- Hermes keeps its procedural skills in its own directory. The agent creates them with `skill_manage`. The person searches, moves between global and project, and deletes them in `/memory-skills`. `skill_manage delete` does not delete skills the person installed into Pi’s own skills directory. Config edits in `hermes-memory-config.json` apply when the extension loads or reloads.

For this page, the usable Pi patterns are a searchable list, an explicit install action, and a separation between agent-written skills and ones the person installed. Skill removal and a skill enable switch have no local contract, so they stay off this page. Pi’s project scope and `/reload` do not transfer: this product has no project entity, and accepted runs stay frozen.

## Community Harnesses

Sources were current official docs as of 2026-09-22. Undocumented screens are omitted.

| Job                | What the docs show                                                                                                                                                                                                                                                                                                                                                                                                                                                                | What does not transfer                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where config lives | Claude Code: settings files plus `/mcp`, `/skills`, `/plugin`, and Desktop Customize / Connectors. Codex: `config.toml` shared by CLI, desktop, and IDE; desktop Settings has Add server. OpenCode: `opencode.json` plus CLI. Goose: `config.yaml` plus Desktop Extensions. Cline: settings JSON plus the Skills and MCP panels. Cursor: Customize plus `mcp.json`.                                                                                                               | This product has no project entity. D4 forbids treating a user-written `.pi` directory as trusted config. The service profile is the catalog.                                            |
| Skills             | Claude `/skills` can cycle a skill on, name-only, user-only, or off. Cline’s Skills tab can create a skill and toggle it without deleting the folder. Cursor lists skills under Customize and can pin one as a Custom Mode. Codex browses skills in the sidebar; disabling a local skill is a `config.toml` flag that needs a restart.                                                                                                                                            | A global skill on/off switch is not the same as this product’s per-run selection. Selection already freezes at accept. Do not add a settings switch unless it maps to an existing field. |
| Roles              | Claude agents are markdown files; since v2.1.198, `/agents` no longer opens a create wizard. Codex custom agents are TOML files, with no documented authoring GUI. OpenCode agents are markdown or JSON, selected with Tab or `@`. Cline’s primary switch is Plan/Act. Cursor’s primary switch is Agent/Plan, with subagent markdown and Custom Modes.                                                                                                                            | Plan/Act and Custom Modes are session modes. This product’s role is an allow-list on the service profile (`putRole`), not a markdown persona and not a mode toggle.                      |
| MCP                | Codex, Cline, Cursor, and Goose all add a server by name plus a local command or a remote URL, then authenticate. Enable is separate from delete: Cursor’s Customize toggle, Cline’s disabled flag, OpenCode’s `enabled`, Goose’s default-extension toggle. Goose also has a second toggle that changes only the current session. Claude uses `/mcp` to disable and reconnect; Desktop Connectors cover curated servers, and arbitrary servers stay in files or `claude mcp add`. | Goose’s current-session toggle would hot-edit an accepted run. D6 already says a new catalog does not enter an existing run, and disable or revoke rejects new calls immediately.        |
| Empty catalog      | Claude Discover, Codex Add server, Goose Add custom extension, Cline New skill, and Cursor’s marketplace are the first actions, not a dead empty line.                                                                                                                                                                                                                                                                                                                            | A plugin marketplace is a later discovery surface. The first action is the install or add flow the service can already persist.                                                          |

Docs: [Claude skills](https://code.claude.com/docs/en/skills), [Claude subagents](https://code.claude.com/docs/en/subagents), [Claude MCP](https://code.claude.com/docs/en/mcp-servers), [Claude Desktop](https://code.claude.com/docs/en/desktop), [Codex skills](https://developers.openai.com/codex/skills), [Codex MCP](https://developers.openai.com/codex/mcp), [Codex subagents](https://developers.openai.com/codex/subagents), [OpenCode skills](https://opencode.ai/docs/skills/), [OpenCode agents](https://opencode.ai/docs/agents/), [OpenCode MCP](https://opencode.ai/docs/mcp-servers/), [Goose extensions](https://goose-docs.ai/docs/getting-started/using-extensions), [Cline skills](https://docs.cline.bot/features/skills), [Cline MCP](https://docs.cline.bot/mcp/mcp-overview), [Cursor skills](https://cursor.com/docs/skills), [Cursor MCP](https://cursor.com/docs/mcp), [Cursor subagents](https://cursor.com/docs/subagents).

## Recommendation

D8 already assigns skill, MCP, and role management to settings, and assigns capability selection to the task and Command flow. This recommendation only fills in the interaction.

The Extensions page edits the service-profile catalog. The composer chooses which installed skills, which role, and which MCP tools a task uses. That choice freezes when the run is accepted. Adding a catalog entry does not change an accepted run. Disabling or revoking an MCP server rejects new calls immediately, which is the D6 rule, and still does not inject tools into an accepted run.

Shared row behavior:

- Keep the three groups and the search. When a group is empty, show its add action beside the empty line. Leave search disabled only while every group is empty.
- Rows stay non-navigating until they have an action. Show the state the payload already has: skill revision and source, role id, MCP connection state and last error.
- While the service is disconnected, lists and actions wait on the existing service status. Do not offer a local file picker as a fallback catalog.

Skills:

- Add Install, using the existing `skillsInstall` bridge. Sources stay the ones `installSkill` already accepts.
- Add Update once `updateSkill` is on the desktop bridge. The page refreshes the list after a published revision. It does not reload the active run.
- Do not add Remove. No uninstall route exists.
- Do not add a settings enable switch. Per-run selection stays on the composer. `disable-model-invocation` stays a skill-file property, not a new settings mode.

Roles:

- Add create and edit for title and allows, backed by `putRole` after that call is on the desktop bridge. The form edits the allow-list. Prose in the form does not grant tools.
- Do not add a markdown agent editor, a Plan/Act switch, or project agent files.

MCP:

- Add a server form for the fields D6 already requires: name, stdio executable, args, and env, or an HTTP URL. Streamable HTTP is the default remote transport; SSE is an explicit choice. Persist with `mcpConfigure` after that call is on the desktop bridge.
- On an existing row, Connect and Authenticate use the bridge methods that already exist. Disable and remove use `mcpConfigure` / `mcpRevoke` after the bridge exposes them.
- Do not add a toggle that enables a server for the current task only. That choice belongs to task staging, which already happens at submit.

Out of this page: plugin marketplaces, in-page skill-body editing, and importing another product’s config file. Those are separate products in Claude, Codex, and Cursor, and this service does not have a contract for them.

## Plan Todos

- [x] Integrate the local capability map: renderer-visible actions versus service-only APIs, and decisions already made about scope and when edits apply.
- [x] Integrate Pi and pi-hermes configuration interactions with file evidence.
- [x] Integrate Claude Code and Codex configuration interactions with source URLs.
- [x] Integrate OpenCode, Goose, Cline, and Cursor configuration interactions with source URLs.
- [x] Write the comparison and the recommended Extensions interactions. Keep jobs the current product already decided out of the open questions.
- [x] Name validation for a later implementation pass. Do not run it in this planning pass.
- [x] Run the plan artifact check after the research sections replace this draft frame.

## Grill-Me Outcome

- Transcript: Not run
- Outcome: Not run
- Summary: Not run. D4–D8 plus the harness docs settle the page-versus-composer split, so an interview was not required.

## Build From Plan

- Ready to build: No
- Selected todos: None. This pass stops at the plan.
- Execution notes: Implementation waits for an explicit request. A later build follows Recommendation. It keeps next-run catalog publication, and it keeps D6’s immediate reject on MCP disable or revoke. It does not treat those as a hot-swap of the active tool set.

## Validation

- Planning pass: the plan artifact check must pass, and every recommended interaction must cite either an existing local contract or an external source.
- Later implementation, not run now: empty groups still show Install, Add role, or Add server; search enables once any row exists; install uses the current bridge and refreshes the list; role save and MCP configure stay disabled until their bridge methods exist; Connect and Authenticate use the current bridge; a disconnected service disables writes; an accepted run does not gain tools added after accept; revoke rejects a new call. Check settings widths 320, 480, 760, 1000, and 1280, plus a short window. Update `en` and `zh-CN` together, and sync the project Figma file in that same implementation pass.

## Risks

- Recommending a settings control for a mutation the service does not expose would invent a contract. Skill removal has no route. Role save and skill update stop at the service. MCP configure and revoke stop at the agent client, short of the desktop bridge.
- Copying a harness flow that edits the live turn would conflict with freeze-on-accept. Pi’s `/reload`, Goose’s current-session extension toggle, and Cursor’s sticky Custom Mode are that kind of mismatch.
- The page copy says MCP edits apply next turn and are never hot-swapped. D6 also rejects new calls immediately after disable or revoke. A later build has to show both, or the disable action will look late.
- Cline’s file-based agent editor and Codex’s skills-disable GUI were not fully documented. They are not part of the recommendation.
- Community docs move. The comparison cites the pages fetched on 2026-09-22.

## Approval

- Status: Research complete — implementation not requested
- Authorization: research and this plan file only
- Implementation: not requested
