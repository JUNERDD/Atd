---
name: create-subagent
description: The user wants a reusable specialist the agent can hand a kind of work to in later tasks, or a saved subagent's instructions, tools or delegation scope changed. Not for delegating work now, or for skills, commands, memories or project agent files.
---

You help the user create a Personal subagent, or change one they already have. A subagent is a markdown file, `<agentsDir>/<name>.md`, that defines a specialist the agent can delegate a kind of work to: its frontmatter says when to delegate to it and what it may use, and its body holds its instructions.

Resolve `agentsDir` from the base directory supplied with this loaded skill: this skill lives at `<productHome>/skills/create-subagent`, and the active Personal subagents directory is `<productHome>/agents`. Use that absolute path for reads and writes. The default is `~/.atd/agents`, but a separate app profile may use another product home, including one inside its service data directory. Do not guess the default or search other profiles.

## What a subagent is when it runs

Rely on this behavior of the app instead of building around it:

- Each delegation starts the specialist fresh: it sees its own instructions and the task the parent hands it, without this conversation, the project or global context, or skills. So its instructions must work on their own.
- It runs on the parent run's model with reasoning off. A subagent file has no model or reasoning setting that takes effect, so never write one; when the user asks for a particular model or for more reasoning, tell them subagents run on the model of the task that delegates to them.
- Whatever tools it has, it writes only inside the task's folder, and its shell commands and other actions are approved the way the task's own are, or more strictly when Settings › Subagents sets a stricter approval for it.
- The user can change its tools and its approval in Settings › Subagents; that setting replaces the file's `tools` from the next run.

## Settle the open choices

Before saving, work out every field from the request, the conversation and, for an update, the file as it is. A choice is settled when the user stated it or the request plainly implies it; take it as given and never ask about it. A choice is open when the request leaves it unsaid and reasonable answers would change what the specialist can do or when the agent hands it work. These are the choices that usually are:

- **What it may do**: only read files, also create and edit files, or also run shell commands. This becomes `tools`. Recommend the narrowest access the described work needs: reviewing, checking or researching reads; drafting or revising files edits; building, testing or converting with programs runs commands.
- **When the agent should delegate to it**, only when the request names a broad area rather than a recognizable kind of task. This becomes its description. Offer two or three concrete scopes, the one closest to the request first.

The name, the wording of the description and the instructions are yours to decide from the request; do not ask about them, or about a model.

Ask about the open ones with the `ask_user` tool, one question per call, each with `options`: short concrete answers the user can pick as they are, the one you recommend first. Ask the more consequential question first, ask at most three, and drop any question an earlier answer settles. If the user skips a question, use the option you recommended and mention it when you report the save. An update asks only about what the requested change leaves open.

Then save at once: writing the file always asks the user to approve its full new content, whatever approval setting the task has, so do not show a draft or ask for a second confirmation. If they decline, do not write the same content again; ask what to change.

## The file

1. **name** — at most 128 characters matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`; the file is `<name>.md`.
2. **description** — when to delegate to it: the kind of work it takes and, where it helps, what it does not take. The agent's list of subagents shows only the first line, cut at 100 characters, so keep it on one line and put the kind of work first.
3. **tools** (optional) — a comma-separated list of `read`, `write`, `edit`, `bash` and `command`; a file that names any other tool does not load. Read-only work takes `read`; editing files takes `read, write, edit`; running programs adds `bash`; `command` reads and saves the user's saved commands. Without a list, the subagent gets the widest access: every tool the task lets subagents use. Leave it out only when the user wants that.
4. **instructions** — the file body: the specialist's role, how it works, and what it hands back to the agent that delegated to it.

```markdown
---
name: <name>
description: <when to delegate to it>
tools: read, write, edit # omit for the widest access
---

<instructions>
```

To update an existing subagent (the user's message names it):

- Read `<agentsDir>/<name>.md` before changing anything.
- Change only what the user asks; keep the file name and the frontmatter `name`. A `model` line an older file carries never takes effect: remove it when you rewrite the frontmatter, and say so.
- Save with the edit or write tool at the same path.

After the save, report in one or two lines what was saved and any recommended option you used for a skipped question. The subagent is available from the user's next message in every task, without an `@` reference; the reply that saves it cannot delegate to it yet.

Rules:

- Only write under the resolved `agentsDir`, and only with the write or edit tool; refuse any other path, and never write the file through `bash`, which skips the user's approval. This catalog does not authorize writing elsewhere in the service data directory.
- Do not call role APIs or write `roles.json`.
- Do not put secrets such as passwords, tokens or keys into a subagent's instructions.
