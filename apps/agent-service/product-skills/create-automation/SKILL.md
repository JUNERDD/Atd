---
name: create-automation
description: Create or change one of the user's automations, agent work this app starts by itself as a new task with nobody present, on a schedule, when files arrive in a folder or after another automation ends. Works out its trigger, the work each run does, what those runs may do and how results reach the user, and saves it with the automation tool. Applies when the user wants work done later, repeatedly or in response to such an event without asking for it each time, and when they want an existing automation's timing, work, permissions or notifications changed. Does not apply to doing the work once now, to saved commands the user runs by hand, to reminders or events kept in other apps, or to schedulers, cron entries and CI workflows that belong to the user's own projects.
---

You help the user create an automation, or change one they already have. Each run of an automation is a new task with nobody present: it cannot ask anything, and whatever its approval tier would ask about is declined. Settle now everything a run will need.

Start with the `automation` tool's `list` operation: it shows the automations the user already has, so you neither add a duplicate nor need to look for any file. Its `context` operation answers the current time, the time zone of the user's Mac and the folders attached to this conversation, with the ids a folder needs.

Work out the following from the request and the conversation; ask the user only for what they leave open:

1. **name** — a short label the user recognizes in Settings › Automations.
2. **trigger** — what starts a run:
   - `schedule`: a `schedule` and the IANA `timezone` its times are read in, the Mac's from `context` unless the user names another. Use a preset: `once` (`at`, an ISO date-time with an offset), `interval` (`everyMinutes`, 15 to 10080, counted from the last run), `daily` (`time`, 24-hour `HH:MM`), `weekly` (`days`, 0 for Sunday to 6 for Saturday, and `time`) or `monthly` (`day`, 1 to 28 or `"last"`, and `time`). Use `cron` (`expression`, five fields, without `?`) only when no preset fits. Nothing runs more often than every 15 minutes.
   - `folder`: files `added` or `changed` (`events`) in a folder `context` lists, by its `folderId`; `patterns` are file-name globs such as `*.pdf` (empty matches every file), and `recursive` includes subfolders. A folder the user has not attached to this conversation cannot be watched: ask them to attach it to their next message in the panel.
   - `automation`: another automation ending (its `automationId` from `list`) with one of the `outcomes` `delivered`, `nothingNew`, `needsAttention` or `failed`.
3. **action** — what each run does:
   - `prompt`: instructions written for a run with nobody present and without this conversation, saying what to do, where to look and what the answer should contain.
   - `command`: a saved command, by `commandId` from the `command` tool's `list`; read it with `get` to fill `arguments` (by parameter key) and `input` (the text of its `{{input}}`). A command that reads the selection, the clipboard or a screenshot cannot run unattended, and one that uses `{{files}}` needs a folder trigger.
4. **policy** — what the unattended runs may do:
   - `permissionTier`: `auto` lets a model review allow routine actions and declines the rest; `manual` declines every guarded action, web search included; `always` runs guarded actions without asking.
   - `tools`, for a prompt only (a command run uses the command's own): from `read`, `write`, `edit`, `bash` and `command`, with `grep`, `find` and `ls` beside `read`. Grant only what the instructions need.
   - `memory`: whether runs search the user's memory; runs never change it.
   - `folderIds`: folders from `context` that every run may read; a folder trigger's own folder is always readable.
   - `maxDurationMinutes`, 5 to 240: a run still going after this is stopped and counts as failed.
   - `missedRuns`: `runOnce` runs the latest occurrence missed while the Mac slept or the app was closed, once and late; `skip` drops them.
   - Leave `model` and `thinkingLevel` out: runs then use the command's own model or the default one.
5. **delivery** — `notify`: `whenNew` notifies only when a run found something new, `always` after every run, `never` only when a run fails or needs attention, which always notify; `includePreviousResult` gives each run the previous answer, so it can report only what changed.
6. **enabled** — whether it starts switched on.

Prefer a sensible default over a question: the `auto` tier, `read`, `write` and `edit` with their search tools for a prompt, memory on, 30 minutes, `runOnce`, `whenNew` with the previous result, switched on. Grant `bash`, `command` or the `always` tier only when the user asks for work that needs them. Before saving a schedule, call `preview` with its trigger: it answers the next run times, or the problem a save would refuse. Show the user the instructions you wrote and the next runs when the request left them open.

When the automation is complete, call `automation` with `op: "create"` and `automation` holding `name`, `enabled`, `trigger`, `action`, `policy` and `delivery`. The tool asks the user to confirm with a plain summary of the automation, so do not ask a second time. Then offer to run it once now with `op: "run"`, so the user sees what a run produces; that asks for confirmation too.

To change an existing automation (the user's message names it, often with its id):

- Read it first with `op: "get"` and its `automationId`; find the id with `list` when you only have a name.
- Change only what the user asks. Send `op: "update"` with the same `automationId`, `expectedRevision` set to the revision you read, and `automation` holding the six fields above, copied from what you read except for the change; leave out `id`, `revision`, `createdBy`, `createdAt` and `updatedAt`. If the update says the automation changed, read it again and reapply the change.
- `enable`, `disable`, `run` and `delete` act on one automation by `automationId`, and each asks the user to confirm. Use them only for what the user asked.

Rules:

- Use only the `automation` tool to read and save automations; never look for or edit automation files on disk.
- A refused save names its problem in parentheses, such as `(tooFrequent)` or `(commandUnavailable)`, followed by the reason: fix that part and save again, or explain it to the user.
- Keep the model and every value the user did not ask to change as they are; the user changes the model in Settings › Automations.
- Do not put secrets such as passwords, tokens or keys into instructions, inputs or arguments.
