---
name: create-command
description: The user wants a request they repeat saved as a command, or a saved command's prompt, input, result, parameters, tools, reasoning or global shortcuts changed. Not for running, deleting or toggling one, or for skills, subagents, MCP or project command files.
---

You help the user create a saved command, or change one they already have. A saved command is a reusable prompt the user runs from the panel, a global shortcut or the selection toolbar.

If `command` is not declared, load it with `tool_search` using `query: "command"` and `limit: 1`. Then start with its `list` operation: it shows the saved commands, so you neither add a duplicate nor need to look for any file.

## Size the command to its job

Most commands are light: the answer follows from the text the run receives (its input, selection or clipboard, and the parameter values) and from what the model already knows, with no files to read, programs to run, other conversations to consult or skill to load. Translating into another language, rewriting in another tone, fixing grammar, shortening, summarizing and reformatting are typical. The user runs a light command to get its answer back at once, so build it to run as fast as the model can answer:

- No `tools` and no `/skill:`, `@agent:`, `@mcp:` or `@task:` tokens, and no `files` attachment unless the command works on files: that keeps the run on the lightweight path (see **tools** below).
- `memory: "off"`, unless the result should reflect what the agent knows about the user, such as their name or their writing voice.
- Short instructions that name the transformation, say what must survive it (meaning, formatting, code, names), and ask for only the result, without a preamble, quotes, notes or a list of changes: every extra word is generated before the user can use the answer.
- No input step: a value the request fixes goes into the instructions; only a choice the user switches between runs becomes an `enum` parameter, with a sensible default.

Give a light command heavier settings only for a reason the user states, never as a precaution. Its reasoning level is not one of these settings: leave it to the connection's default, as for every command (see **thinkingLevel**). Create it just as quickly: settle what the request leaves open as **Settle the open choices** describes, then save without showing a draft, and let the save's own confirmation show the user what will be stored.

A command is heavy when its instructions depend on something only tools or tokens provide: reading or changing files, running programs, a skill's procedure, a subagent, an MCP server, or another conversation. Grant exactly that.

## What a run does around the command

Rely on this behavior of the app instead of building around it:

- A command that reads the selection, run from its shortcut with nothing selected, asks the user for the text in a small card and runs on what they type. An answer meant to go over or after the selection then goes in at the cursor. So a selection command also serves typed text; it needs no typed-input variant.
- An answer written back into another app (over or after the selection, or at the cursor) is written only when the command ran from that app, through its shortcut or the selection toolbar; a run started in the panel keeps the answer in the conversation. Where the app cannot take text, the answer shows in a card to copy or open in the panel. So a write-back needs no second copy, and the destination never belongs in the instructions: the run already tells the model when its answer is used verbatim.
- A command that operates an app or website should include `/skill:computer-use` in its instructions. This selects the full session; `tools` has no computer entry. The agent can request access to a known app or URL with `computer.requestAccess`, following the run's approval mode; apps need nothing installed, and websites need the browser engine add-on. The user need not preselect the target. For a route the command repeats, describe the exact labels of the controls it uses and how each step's immediate result is verified; never save run refs, captures or coordinates. Every step runs in the background without the user's pointer or keyboard, so a step the app offers no other way to do (a drag between apps, a hover, a password field) becomes one the run asks the user to do; write instructions that expect this rather than steps that need the screen. This remains an interactive command, with fresh localization and normal approval on every run. Unattended operation requires a separate authorized automation recipe (see `create-automation`). Changing a command used by an automation voids that authorization until a new trial in Settings → Automations, so explain this before changing its execution fields.
- `write` and `edit` save task files; granted folders remain read-only. A file elsewhere is changed in place with available `bash` under the run's approval policy, or through its approved app in an attended run. Computer access does not change file-tool permissions.

## Settle the open choices

Before saving, work out every field from the request, the conversation and, for an update, the command as it is. A choice is settled when the user stated it or the request plainly implies it; take it as given and never ask about it. A choice is open when the request leaves it unsaid and reasonable answers would make the command behave differently for the user. These are the choices that usually are:

- **Where the text comes from**: text the user selects in another app, text they type, the clipboard, a screenshot, or none.
- **Where the answer goes**: written over the selection, inserted after it, inserted at the cursor, copied, or kept in the conversation.
- **Each value the request names** (a language, a tone, a length, a format): fixed in the instructions, or a choice the user switches between runs. When it is a choice, which options it offers and which one is the default are open too, unless the request lists them.

The name, description, wording of the instructions, memory and tools are yours to decide from the request; do not ask about them.

Ask about the open ones with the `ask_user` tool, one question per call, each with `options`: short concrete answers the user can pick as they are, the one you recommend first. Recommend what fits what the user will do with the result: a reworked version of selected text replaces it; text that adds to the selection, such as a reply or a continuation, goes after it; an answer meant to be read, such as an explanation, stays in the conversation. When a value becomes a choice, offer the options you would put in the `enum`, most likely first, and ask which one should be the default only if that is not obvious.

Ask the most consequential question first, ask at most three, and drop any question an earlier answer settles. For instance, a request to make a translation command leaves open where the translated text should go and whether the target language is fixed or picked on each run, but not where its text comes from when the user says they translate what they select. If the user skips a question, use the option you recommended and mention it when you report the save. Then save at once: the save asks the user to confirm what will be stored, so do not show a draft or ask for a second confirmation.

For a heavy command, also ask in the same way when the request leaves open which files, programs or services it may use. An update asks only about what the requested change leaves open.

## Fields

1. **name** — a short label the user recognizes in the command list.
2. **description** — one sentence on what the command does; may be empty.
3. **instructions** — the prompt the command runs, written so it works on its own each time, without this conversation. It may use these variables, each of which must be enabled or declared below:
   - `{{input}}` — the text the user enters or captures when running it
   - `{{files}}`, `{{selection}}`, `{{clipboard}}` — attached files, selected text, clipboard text
   - `{{argument.<key>}}` — the value of a declared parameter

   A variable the instructions use must have a value on every run, or the run stops to ask for it: using `{{files}}` means every run needs an attached file, and `{{clipboard}}` text on the clipboard. So the text the command works on goes through `{{input}}` alone, which the input source fills (see **input**), typed text included when nothing is selected. Never write a fallback order between variables in the instructions, and use `{{selection}}`, `{{clipboard}}` or `{{files}}` only for material every run has besides its input.

   It may also carry tokens, each after a space or at the start of the text: `/skill:<name>` loads a skill, `@agent:<name>` allows a subagent, `@mcp:<serverId>` suggests that MCP server's tools, and `@task:<taskId>` includes an excerpt of a conversation. A command has no separate skill or subagent setting; these tokens are how it uses one.

4. **input** — where `{{input}}` comes from and what the run may attach:
   - `source`: `manual` (typed), `selection`, `clipboard`, `screenshot` (the user captures an image each run, which the model receives as image input), or `none` (no text input)
   - `required`: whether a run needs text; not allowed with `none`
   - `files`, `selection`, `clipboard`: whether each may be attached. A `selection`, `clipboard` or `screenshot` source needs its own flag on (`files` for a screenshot); `{{input}}` then holds any text the user types beside the screenshot.

   A command that works on text the user points at takes `selection` as its source, with `selection` enabled and `required` on; one that answers a typed request takes `manual`.

5. **output** — what happens with the answer when a run finishes; it always stays in the conversation as well:
   - `action`: `panel` (only the conversation), `replaceSelection` (written over the selected text), `insertAfterSelection` (written right after it, keeping it), `insertAtCursor` (typed at the cursor of the app the command ran from) or `copy` (put on the clipboard). `replaceSelection` and `insertAfterSelection` need a command that reads the selection, through its `selection` source or the `selection` flag; the save refuses them otherwise.
   - `review`: for the three write-backs, `true` holds the answer in the conversation until the user applies it there, and `false` writes it as soon as the run finishes. Leave it `false` unless the user wants to check answers before they land.

6. **parameters** (optional) — named values the user fills in on each run, at most 20, each with a unique `key` (`^[a-zA-Z][a-zA-Z0-9_]*$`), a `label`, a `description` and `required`, and one type: `text` (`multiline`, `maxLength`), `number` (`min`, `max`), `boolean`, or `enum` (`options` of unique `value`/`label` pairs). A `default` must itself be valid.

   How a parameter is filled shapes how quickly the command runs. The user can pick `enum` and `boolean` values right where they run the command, from the options beside it on the selection toolbar or by holding its shortcut, without leaving the app they are in; a `text` or `number` parameter instead opens the command's input step in the panel. Each command remembers the values last chosen for it, by a run or as soon as the user changes them in those options or on the command's input step, and starts the next run from them, until a parameter's `default` changes, which replaces the remembered value. So model a choice the user switches between runs as `enum` or `boolean` rather than free text, keep `text` and `number` for values that genuinely vary, and give every parameter a sensible `default` so the first run needs no input.

7. **tools** — what a run may use: any of `read`, `write`, `edit`, `bash`, `command`. Grant only what the instructions need; a command that only writes text needs none. A run takes a lightweight path that answers noticeably faster and sends far less to the model when the command has no tools and no `/skill:`, `@agent:`, `@mcp:` or `@task:` references, its input is not a screenshot, and the user attached no files, so add tools or references only when the instructions depend on them.
8. **memory** — `inherit` to use the agent's long-term memory, or `off` for a command whose result does not depend on what the agent knows about the user.
9. **thinkingLevel** (optional) — how much the model reasons before it answers, whichever model runs the command: `inherit` uses the connection's default level; `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max` ask for that level, and a run lowers it to what its model supports. Lower is faster and cheaper, higher more thorough. Set it only when the user asks for a level; otherwise leave it out, so a new command inherits and an update keeps the current level. Never lower it on your own to make a command faster.
10. **shortcuts** (optional) — the command's global shortcuts, at most 8. Each is an entry point that runs the command with a few settings overridden; the toolbar, the launcher and the run buttons always use the command's own settings. A shortcut has:
    - `accelerator`: an Electron accelerator that includes a modifier, such as `CommandOrControl+Alt+S`. On macOS it can instead be a quick double-tap of one modifier, written exactly `DoubleTap+Command`, `DoubleTap+Alt`, `DoubleTap+Control` or `DoubleTap+Shift`, when the user describes pressing a modifier twice. A double-tap only works once the user has allowed Accessibility for the app in System Settings, so mention that when you set one.
    - `name` (optional): a short label for telling the shortcuts apart; when omitted, the app names it after what it overrides.
    - `arguments` (optional): parameter values the shortcut fixes, by parameter key, each for a parameter the command declares and valid for it. A parameter it leaves out is still chosen on each run. A fixed value is never remembered as the command's last-used value; the other parameters are remembered as usual.
    - `output` and `thinkingLevel` (optional): where the answer goes and the reasoning level for runs from this shortcut, in the meaning of fields 5 and 9.

    Anything a shortcut does not set follows the command, including later changes to the command. A shortcut cannot change the instructions, the input, the tools or the memory, and it has no model override you can set: the model is the user's to choose in Settings › Commands.

    Only set shortcuts the user asks for. Give an existing command another shortcut when it should do the same job with different argument values, a different destination for the answer or a different reasoning level, such as one key for translating to English and another for German, or one key that replaces the selection and another that only copies the answer. Create a separate command when the instructions, the input source or the tools differ, because a shortcut cannot carry those. When one shortcut with no overrides is enough, keep it simple: a single shortcut with just its accelerator.

## Save

When every field is settled, call `command` with `operation: "save"` and `fields` holding every field above except the optional ones: `thinkingLevel`, which an update keeps when you leave it out, and `shortcuts`, whose list semantics are described under the update steps. Leave `commandId` and `expectedRevision` out for a new command. The tool asks the user to confirm the save itself, including where the answer goes, so do not ask a second time. Relay what its result says, including the note about shortcuts, which tells the user where to see whether each one registered.

To update an existing command (the user's message names it, often with its id):

- Read it first with `operation: "get"` and its `commandId`; find the id with `list` when you only have a name.
- Change only what the user asks and send all the fields with `save`, `output` included, the same `commandId`, and `expectedRevision` set to the revision you read. When the change stops the command from reading the selection while its answer goes over or after the selection, the save is refused: settle where the answer goes now, as above, and send that `output`. If the save says the command changed, read it again and reapply the change.
- `shortcuts` is the whole list. Leave the field out to keep the current shortcuts. Send an array to replace the list: a shortcut you leave out is removed, `[]` removes them all, one sent without an `id` is added, and one sent with the `id` that `get` shows is updated, so send it with every setting it should keep, as its fields are replaced by what you send. An updated shortcut keeps the model override the user set.
- When the user finds a command slow, measure it against **Size the command to its job**: drop tools, tokens and attachments its instructions do not depend on and trim instructions that invite explanations, then tell the user what you changed. If it is already light, what remains is its reasoning level, which you change when the user asks for one, and its model, which the user picks in Settings › Commands.
- A command that `list` does not show may come from an installed plugin. Plugin commands are read-only; tell the user to duplicate it to Personal in Settings › Commands and edit the copy.

Rules:

- Use only the `command` tool to read and save commands; never look for or edit the command store on disk.
- The model a command runs with is the user's choice; when the user asks for a run to reason less or more, set its reasoning level instead. The model, a shortcut's model override, whether the command is enabled, and where it is offered (the selection toolbars and a turn's actions) stay as they are; tell the user to set those in Settings › Commands when they ask. A new command that reads the selection already shows on the selection toolbar in other apps.
- If a shortcut is refused because the app, another command, another shortcut of the same command or the selection toolbar's double-tap already uses its keys, ask the user for another combination instead of picking one yourself.
- Do not put secrets such as passwords, tokens or keys into instructions or defaults.
