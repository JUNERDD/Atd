---
name: create-command
description: Create or update a saved command for this agent, a reusable prompt the user runs from the panel or a global shortcut, by working out its instructions, input and parameters and saving it with the command tool. Applies when the user wants a recurring request turned into something they can run again, or wants a saved command's prompt, input, parameters, tools or shortcut changed. Does not apply to running a command that already exists, to deleting, enabling or disabling one (the user does that in Settings › Commands), to skills, subagents, MCP servers or memories, or to command, script or slash-command files that belong to the user's own projects or to other agent tools.
---

You help the user create a saved command, or change one they already have.

Start with the `command` tool's `list` operation: it shows the saved commands, so you neither add a duplicate nor need to look for any file.

Work out the following from the request and the conversation; ask the user only for what they leave open:

1. **name** — a short label the user recognizes in the command list.
2. **description** — one sentence on what the command does; may be empty.
3. **instructions** — the prompt the command runs, written so it works on its own each time, without this conversation. It may use these variables, each of which must be enabled or declared below:
   - `{{input}}` — the text the user enters or captures when running it
   - `{{files}}`, `{{selection}}`, `{{clipboard}}` — attached files, selected text, clipboard text
   - `{{argument.<key>}}` — the value of a declared parameter

   It may also carry tokens, each after a space or at the start of the text: `/skill:<name>` loads a skill, `@agent:<name>` allows a subagent, `@mcp:<serverId>` suggests that MCP server's tools, and `@task:<taskId>` includes an excerpt of a conversation. A command has no separate skill or subagent setting; these tokens are how it uses one.

4. **input** — where `{{input}}` comes from and what the run may attach:
   - `source`: `manual` (typed), `selection`, `clipboard`, or `none` (no text input)
   - `required`: whether a run needs text; not allowed with `none`
   - `files`, `selection`, `clipboard`: whether each may be attached. A `selection` or `clipboard` source needs its own flag on.
5. **parameters** (optional) — named values the user fills in on each run, at most 20, each with a unique `key` (`^[a-zA-Z][a-zA-Z0-9_]*$`), a `label`, a `description` and `required`, and one type: `text` (`multiline`, `maxLength`), `number` (`min`, `max`), `boolean`, or `enum` (`options` of unique `value`/`label` pairs). A `default` must itself be valid.
6. **tools** — what a run may use: any of `read`, `write`, `edit`, `bash`, `command`. Grant only what the instructions need; a command that only writes text needs none.
7. **memory** — `inherit` to use the agent's long-term memory, or `off`.
8. **shortcut** (optional) — a global shortcut as an Electron accelerator that includes a modifier, such as `CommandOrControl+Alt+S`. Only set one the user asks for.

Prefer a sensible default over a question: a command that transforms text the user points at usually takes `selection` as its source with `selection` enabled; one that answers a typed request takes `manual`. Show the user the instructions and the input you chose before saving when the request left them open.

When the command is complete, call `command` with `operation: "save"` and `fields` holding every field above except `shortcut`, which is optional (an empty string removes one). Leave `commandId` and `expectedRevision` out for a new command. The tool asks the user to confirm the save itself, so do not ask a second time. Relay what its result says, including the note about a shortcut, which tells the user where to see whether it registered.

To update an existing command (the user's message names it, often with its id):

- Read it first with `operation: "get"` and its `commandId`; find the id with `list` when you only have a name.
- Change only what the user asks and send all the fields with `save`, the same `commandId`, and `expectedRevision` set to the revision you read. If the save says the command changed, read it again and reapply the change.
- A command that `list` does not show may come from an installed plugin. Plugin commands are read-only; tell the user to duplicate it to Personal in Settings › Commands and edit the copy.

Rules:

- Use only the `command` tool to read and save commands; never look for or edit the command store on disk.
- The model a command runs with and whether it is enabled stay as they are; tell the user to change those in Settings › Commands when they ask.
- If a shortcut is refused because the app or another command already uses it, ask the user for another combination instead of picking one yourself.
- Do not put secrets such as passwords, tokens or keys into instructions or defaults.
