---
name: plan-mode
description: Plan before acting. Research the task folder read-only, write an editable Markdown plan with code references, decisions and todos, and ask for approval before executing it.
disable-model-invocation: true
companion-skills: [grill-me]
---

# Plan Mode

## Overview

Create a disk-backed, editable Markdown plan in the task folder, research the task into it, resolve material questions, and keep file references and todos current. The plan file records the work. Loading this skill (the `/plan-mode` chip) always means planning first: nothing outside the planning artifacts changes until the user approves the plan through the approval gate below.

Read `references/architecture.md` (relative to this skill's directory; reading it needs no confirmation) only for complex planning cases: tool boundaries, read-only subagent exploration, diagrams, multi-system data flow, or a non-trivial handoff from an approved plan to execution.

## Tools In This App

- Read-only investigation: `read`, `grep`, `find`, `ls` (confined to the task folder), `web_search` and `fetch_content` for documentation lookups, and `ask_user` for questions. Paths are relative to the task folder.
- Planning writes: `write` and `edit`, only on the planning artifacts listed below. Each write may ask the user for permission; if the user declines, do not retry. Keep the content in chat and say which file was not written.
- `bash`: every command goes through the shell allowlist or a user confirmation. Before approval, only side-effect-free commands such as `git status`, `git diff` or `date +%F`.
- `subagent`: when available, you may delegate bounded read-only discovery to a task agent you define for it with `{ action: "define" }`. Give it only `read`, `grep`, `find` and `ls` (plus `web_search` and `fetch_content` when the question needs the web) and instructions to change nothing, then launch it as `task.<name>` in a later message with a bounded read-only objective.
- `todo`: the execution checklist. Use it only after approval (see Handoff To Execution).

## Core Contract

Hard rules. They hold for the whole run until the user approves the plan:

- Before the user approves: do only read-only investigation, plus reading and writing the plan file itself, and grill-me's Q&A log and outcome file when grill-me runs. Do not modify any other file in the task folder. Do not run bash commands with side effects. That means no installs, generators, formatters, migrations, scripts that write output, service starts, or git commands that change state.
- When the plan is ready: request approval with `ask_user` offering at least the two options `Approve and execute` and `Needs changes`, in the user's language (see Approval Gate). On `Needs changes`, collect the feedback, update the plan file, and request approval again. Loop until the user approves or stops.
- Only after approval: start executing, first syncing the plan's approved todos into the `todo` tool, then advance their status as execution proceeds.

Scope rules:

- Approval of research or of the plan's direction is not approval to implement. Only the approval gate grants that.
- Execute only approved todos. If the user approves a subset, execute only those items and leave the others untouched.
- Do not expand scope during execution. Pause only the affected work when a new product decision, a scope expansion, or missing authority needs the user's input.
- Treat the plan as an editable file. If the user edits it directly, reread it before changing it or building from it.
- Treat existing changes in the task folder as the user's. Plan around them; do not revert or normalize them.

## Planning Workflow

1. Create or reuse the Markdown plan file immediately (see Plan Artifact Rules), then cite its path.
2. Research the task folder, documentation, diagnostics and relevant conventions with read-only tools.
3. Update the plan with concrete file paths, code references, discovered constraints and unresolved questions.
4. Ask focused clarifying questions with `ask_user` when the answer would change the plan. After each answer, update the plan file before moving on.
5. Maintain `Plan Todos` as editable checklist items. Include dependencies and enough detail for another agent to build from the plan.
6. Pressure-test meaningful assumptions and failure modes against the evidence. Use grill-me when the user asks for an interview or unresolved user decisions benefit from one; complexity alone does not require a question loop. Record the grill-me transcript and outcome paths in the plan when it runs.
7. Mark the plan ready to build only when blocking questions are resolved, the todos are concrete, and validation is named. Otherwise keep it in draft and name the exact blocker.
8. Run the plan self-check and fix any missing heading or placeholder before requesting approval.
9. Summarize the plan briefly in chat with its path, then request approval through the approval gate.
10. After approval, build from the plan within the approved scope.

## Grill-Me Pressure Test

The grill-me skill's instructions are loaded alongside this skill in the same run. Use it as the specialized step instead of recreating it. It stays inactive unless the conditions below call for it.

- Use grill-me for an explicitly requested interview, or for material unresolved decisions that need the user's judgment. First resolve what the task folder and the conversation already establish.
- Skip the interview when evidence, settled decisions or reasonable in-scope assumptions resolve the plan.
- Let grill-me ask one logged question at a time through `ask_user` and follow its logging and finalization rules. Do not ask ad hoc pressure-test questions and log them later.
- Its transcript and planning-ready outcome are planning artifacts, so writing them is allowed before approval. Name them after the plan (`plans/grill-me/session-<plan file name>` and `plans/grill-me/outcome-<plan file name>`).
- After grill-me finalizes, write the transcript and outcome paths into the plan's `Grill-Me Outcome` section with a terse status or one-line summary. Do not paste the full outcome into the plan.

## Plan Artifact Rules

The Markdown plan file is the required editable planning artifact and the approval artifact. A chat message may summarize it but never replaces it.

- Skip the plan file only when the user explicitly says not to write one or the file cannot be written. In that case, say why no plan file exists.
- Location: a path the user gives always wins. Otherwise use `plans/<YYYY-MM-DD>-<slug>.md` in the task folder. The slug is the title in lowercase with every run of other characters replaced by `-`, at most 64 characters, or `plan` when empty. If that file already exists and is not this plan, add `-2`, `-3`, and so on. When continuing the same plan, update the same file.
- Date: the app gives you no clock. Use today's date when the conversation shows it. Otherwise run `date +%F` once through `bash`; it has no side effects, but the user may be asked to allow it. If you still have no date, leave out the date prefix and write `Created: not recorded`.
- Only the plan file and grill-me's files may be written in plan mode. The `write` tool creates missing parent directories for them.
- Use Markdown checkboxes for todos. Keep them editable and stable enough that selected todos can be handed to an execution pass.
- Record plan status separately from authorization. `Draft - awaiting approval` stays until the user approves through the gate.
- If the plan changes after feedback, update the same file and request approval again.

Write this skeleton first, then replace every `TBD` with real content as research proceeds:

```markdown
# <plan title>

Status: Draft - awaiting approval
Created: <YYYY-MM-DD>
Approval: Awaiting user approval

## Summary

TBD

## Clarifying Questions

- [ ] TBD

## File And Code References

- TBD

## Plan Todos

- [ ] TBD

## Grill-Me Outcome

- Transcript: Not run
- Outcome: Not run
- Summary: TBD

## Build From Plan

- Ready to build: No
- Selected todos: TBD
- Execution notes: TBD

## Validation

- TBD

## Risks

- TBD

## Approval

- Status: Draft - awaiting approval
```

### Plan Self-Check

Before requesting approval, `read` the plan file back from disk and confirm:

1. All nine headings are present exactly: `## Summary`, `## Clarifying Questions`, `## File And Code References`, `## Plan Todos`, `## Grill-Me Outcome`, `## Build From Plan`, `## Validation`, `## Risks`, `## Approval`.
2. No placeholder remains. Run `grep` on the plan file with pattern `\b(TBD|TODO|PLACEHOLDER)\b|\[fill` and `ignoreCase: true`. Every match must be gone, except a mention of the `todo` tool itself.
3. Every todo names a concrete code area or file, and `Validation` names real checks.

If the check fails, fix the file and check again. Do not request approval until it passes, or until you explicitly report why it cannot pass.

## Approval Gate

When the plan passes the self-check, call `ask_user` with a short question that names the plan path and exactly two options: an approve option first and a needs-changes option second. Write the question and both options in the language the user is writing in. For English and Chinese use these labels verbatim:

```json
{
  "question": "The plan is ready: plans/<file>.md. Approve it to start execution, or say what needs to change.",
  "options": ["Approve and execute", "Needs changes"]
}
```

```json
{
  "question": "计划已就绪：plans/<file>.md。批准后开始执行，或说明需要修改的地方。",
  "options": ["批准执行", "需要修改"]
}
```

Keep `question` under 4000 characters and each option under 500. The plan itself stays in the file. The tool returns the chosen option's text verbatim, or text the user typed instead. Below, `Approve and execute` and `Needs changes` stand for the approve and needs-changes options in whichever language you used:

- `Approve and execute`: approved for all todos. Set `Status: Approved - executing`, `Approval: Approved by the user` and the `## Approval` status, set `Ready to build: Yes` and the selected todos, then go to Handoff To Execution.
- `Needs changes`: call `ask_user` again with only a `question` (for example, "What should change in the plan?") and no options, so the user types the feedback. Update the plan file, rerun the self-check, and call the approval gate again.
- Typed text: if it clearly approves, possibly for a subset ("approve todos 1-3"), treat it as approval of exactly that scope and record the selection. Otherwise treat the text itself as the change feedback: update the plan, rerun the self-check, and ask again.
- `The user cancelled the request.`: the user skipped the question or sent a message instead. This is not approval. Treat a new user message as feedback or a new instruction. Otherwise stop, leave the plan in `Draft - awaiting approval`, and say that it is waiting for approval.

## Clarification Rules

Ask questions early when the answer changes the plan.

- Ask one or two critical questions at a time, each through `ask_user`. Offer `options` (up to 8) when there are a few discrete answers, and put the recommended default first. The user can always type a different answer.
- Apply a sensible, low-risk default within scope when one exists, and record material assumptions in the plan.
- Do not ask about trivia that reading the task folder or its documentation can answer.

## Research Rules

Keep research proportional to risk.

- For small tasks, read the directly relevant files and stop.
- For large folders, map ownership boundaries, routes, data contracts and verification surfaces with `grep` and `find`. When independent discovery is faster in parallel, delegate it to the read-only task agent described under Tools In This App, giving each child a bounded read-only objective and asking for paths, evidence, blockers and residual risks.
- Do not redo a delegated investigation yourself unless the result is blocking and unavailable.

## Plan Structure

Make the plan easy to accept or reject.

- Name the files or modules likely to change, with code references when useful.
- Keep a live todo checklist that can be edited, selected and built from.
- Include build notes that say how to execute the plan after approval.
- Include validation commands or manual checks, and any expected non-goals.
- Call out tradeoffs only when they affect the chosen approach.
- Include concise code snippets only when they clarify a non-obvious target.
- Use Mermaid diagrams inside the plan when they reduce ambiguity.
- Resolve blocking questions before marking the plan ready to build. If they cannot be resolved, deliver the completed research and name the exact blocked decision without implying readiness.

## Handoff To Execution

After approval, build from the plan file.

1. Reread the latest user message and the plan file from disk, especially after a long pause or compaction.
2. Sync todos: call `todo` with `{"action":"list"}`. Reuse items that already match this plan. Remove items from a superseded version of this plan with `{"action":"delete","id":N}`. Never `clear` a list that holds unrelated items.
3. Create one item per approved plan todo, in plan order: `{"action":"create","subject":"<short imperative>","description":"<detail and the plan todo it mirrors>"}`. Express dependencies with `blockedBy: [<ids>]` on create, using the ids the tool returned. Do not create items for todos that were not approved.
4. Before starting an item: `{"action":"update","id":N,"status":"in_progress","activeForm":"<present-continuous label>"}`. Keep exactly one item in progress.
5. When an item is done: `{"action":"update","id":N,"status":"completed"}` immediately, and tick its checkbox in the plan file. `completed` is final, so do not mark an item completed while tests fail or the work is partial. Keep it in progress and create a new item for the blocker.
6. Keep edits scoped to the approved outcome. Update the plan for evidence-backed adjustments within that scope.
7. Run the validation the plan promised, or explain why a check could not run. After execution, set `Status: Completed` (or name what remains), summarize what changed, report validation results and skipped checks, and mention only risks that genuinely matter.
