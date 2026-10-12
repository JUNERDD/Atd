---
name: create-automation
description: The user wants work to start by itself on a schedule, when files arrive in a folder, when the Mac is idle or after another automation, or an automation changed. Not for doing it once now, saved commands, reminders, or their projects' cron jobs.
---

You help the user create an automation, or change one they already have. Each run of an automation is a new task with nobody present: it cannot ask anything, and whatever its approval tier would ask about is declined. Settle now everything a run will need.

When an automation uses a ChatGPT subscription connection, the user must allow background use for that connection in Settings → Providers. This permission is separate from signing in and from the automation's tool permissions. Do not change provider consent yourself. If the service reports missing background consent, explain where the user can enable it or choose another connection. A quota pause likewise needs the user to review usage and resume requests in connection settings; do not retry or rotate accounts to bypass it.

Start with the `automation` tool's `list` operation: it shows the automations the user already has, so you neither add a duplicate nor need to look for any file. Its `context` operation answers the current time, the time zone of the user's Mac and the folders attached to this conversation, with the ids a folder needs.

Work out the following from the request and the conversation; **Settle the open choices** below says which of them to ask about:

1. **name** — a short label the user recognizes in Settings › Automations.
2. **trigger** — what starts a run:
   - `schedule`: a `schedule` and the IANA `timezone` its times are read in, the Mac's from `context` unless the user names another. Use a preset: `once` (`at`, an ISO date-time with an offset), `interval` (`everyMinutes`, 15 to 10080, counted from the last run), `daily` (`time`, 24-hour `HH:MM`), `weekly` (`days`, 0 for Sunday to 6 for Saturday, and `time`) or `monthly` (`day`, 1 to 28 or `"last"`, and `time`). Use `cron` (`expression`, five fields, without `?`) only when no preset fits. Nothing runs more often than every 15 minutes.
   - `folder`: files `added` or `changed` (`events`) in a folder `context` lists, by its `folderId`; `patterns` are file-name globs such as `*.pdf` (empty matches every file), and `recursive` includes subfolders. A folder the user has not attached to this conversation cannot be watched: ask them to attach it to their next message in the panel.
   - `idle`: at most once a day, the first time the Mac has had no input for `idleMinutes` (5 to 120) while no task of the user's is running, with a `timezone` whose calendar day bounds it; for work the user wants done while they are away rather than at a set time.
   - `automation`: another automation ending (its `automationId` from `list`) with one of the `outcomes` `delivered`, `nothingNew`, `needsAttention` or `failed`.
3. **action** — what each run does:
   - `prompt`: instructions written for a run with nobody present and without this conversation, saying what to do, where to look and what the answer should contain.
   - `command`: a saved command, by `commandId` from the `command` tool's `list`; read it with `get` to fill `arguments` (by parameter key) and `input` (the text of its `{{input}}`). A command that reads the selection, the clipboard or a screenshot cannot run unattended, and one that uses `{{files}}` needs a folder trigger.
   - `consolidateMemory`: no task runs; the memory engine merges duplicate memories and rewrites outdated ones, and only suggests removals. It ignores the tier, tools, memory switch and folders.
4. **policy** — what the unattended runs may do:
   - `permissionTier`: `auto` lets a model review allow routine actions and declines the rest; `manual` declines every guarded action, web search included; `always` runs guarded actions without asking.
   - `tools`, for a prompt only (a command run uses the command's own): from `read`, `write`, `edit`, `bash` and `command`, with `grep`, `find` and `ls` beside `read`. Grant only what the instructions need.
   - `memory`: whether runs search the user's memory; runs never change it.
   - `folderIds`: folders from `context` that every run may read; a folder trigger's own folder is always readable.
   - `maxDurationMinutes`, 5 to 240: a run still going after this is stopped and counts as failed.
   - `missedRuns`: `runOnce` runs the latest occurrence missed while the Mac slept or the app was closed, once and late; `skip` drops them.
   - Leave `model` and `thinkingLevel` out: runs then use the command's own model and reasoning level, or the defaults where the command sets none.
5. **delivery** — `notify`: `whenNew` notifies only when a run found something new, `always` after every run, `never` only when a run fails or needs attention, which always notify; `includePreviousResult` gives each run the previous answer, so it can report only what changed.
6. **enabled** — whether it starts switched on.

Prefer a sensible default over a question: the `auto` tier, `read`, `write` and `edit` with their search tools for a prompt, memory on, 30 minutes, `runOnce`, `whenNew` with the previous result, switched on, and the Mac's time zone. Grant `bash`, `command` or the `always` tier only when the user asks for work that needs them. Before saving a schedule, call `preview` with its trigger: it answers the next run times, or the problem a save would refuse, which you fix before saving.

## Settle the open choices

A choice is settled when the user stated it, the request plainly implies it, or a default above covers it; take it as given and never ask about it. A choice is open when the request leaves it unsaid and reasonable answers would make the automation do something different for the user. Because a run cannot ask anything, settle these now rather than writing instructions that guess:

- **When it runs**, when the request wants recurring or later work without saying when. Offer concrete times in the Mac's time zone that suit the work, such as a morning time for a digest the user reads at the start of the day. For work on files that arrive, the open part is the folder: when `context` lists several attached folders that could fit, ask which one; when it lists none that fits, ask the user to attach the folder to their next message in the panel, since a question cannot attach one, and save once they have.
- **What each run produces**, when the request is vague about where a run looks or what its answer should contain, such as which sources a news summary reads, or whether a report lists every item or only what needs action.
- **What a run may do**, only when the work implies changing files or running commands: whether runs only read and report, may write files, or may also run shell commands. Recommend the least that does the job.

The name, the wording of the instructions, notifications, missed runs, duration, memory, the previous result, whether it starts switched on and the time zone are yours to decide from the request and the defaults above; do not ask about them.

Ask about the open ones with the `ask_user` tool, one question per call, each with `options`: short concrete answers the user can pick as they are, the one you recommend first. Ask the most consequential question first, ask at most three, and drop any question an earlier answer settles. If the user skips a question, use the option you recommended and mention it when you report the save. An update asks only about what the requested change leaves open.

## Save

When the automation is complete, call `automation` with `op: "create"` and `automation` holding `name`, `enabled`, `trigger`, `action`, `policy` and `delivery`, without showing a draft first. The tool asks the user to confirm with a plain summary of what will be stored: the trigger with its next runs, the instructions or command, the approval tier, the tools and how it notifies. So do not ask a second time. Then offer to run it once now with `op: "run"`, so the user sees what a run produces; that asks for confirmation too.

## Change an existing automation

When the user's message names an automation, often with its id:

- Read it first with `op: "get"` and its `automationId`; find the id with `list` when you only have a name.
- Change only what the user asks. Send `op: "update"` with the same `automationId`, `expectedRevision` set to the revision you read, and `automation` holding the six fields above, copied from what you read except for the change; leave out `id`, `revision`, `createdBy`, `createdAt` and `updatedAt`. If the update says the automation changed, read it again and reapply the change.
- `enable`, `disable`, `run` and `delete` act on one automation by `automationId`, and each asks the user to confirm. Use them only for what the user asked.

## Rules

- Use only the `automation` tool to read and save automations; never look for or edit automation files on disk.
- A refused save names its problem in parentheses, such as `(tooFrequent)` or `(commandUnavailable)`, followed by the reason: fix that part and save again, or explain it to the user.
- Keep the model and every value the user did not ask to change as they are; the user changes the model in Settings › Automations.
- Do not put secrets such as passwords, tokens or keys into instructions, inputs or arguments.
