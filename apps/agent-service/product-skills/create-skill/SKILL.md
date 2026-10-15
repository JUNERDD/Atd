---
name: create-skill
description: The user wants the agent to gain or change a reusable way of doing a recurring kind of work, saved as a skill. Not for instructions for this task only, for commands, subagents or memories, or for skill files of projects or other tools.
---

You help the user create a Personal skill, or change one they already have. A skill is `<skillsDir>/<name>/SKILL.md`: YAML frontmatter, then a body that tells the agent how to carry out a recurring kind of work. Every later task lists it by name and description, and the agent loads the body when a task matches the description.

Resolve `skillsDir` from the base directory supplied with this loaded skill: this skill lives at `<skillsDir>/create-skill`, so its parent is the active Personal skills directory. Use that absolute path for reads and writes. The default is `~/.atd/skills`, but a separate app profile may use another product home, including one inside its service data directory. Do not guess the default or search other profiles.

## Settle the open choices

Before saving, work out the skill from the request, the conversation and, for an update, the skill as it is. A choice is settled when the user stated it or the request plainly implies it; take it as given and never ask about it. A choice is open when the request leaves it unsaid and reasonable answers would make the agent use the skill differently or do the work differently. These are the choices that usually are:

- **When it applies and what it excludes**: the kind of work the skill is for, and the nearby work it must stay out of. This becomes the description, which decides when the agent loads it. Ask when the request names a broad area or leaves its edges unclear; offer two or three concrete scopes, the one closest to the request first.
- **The user's own procedure**: steps, conventions, tools or standards the request refers to without spelling out, such as how their team writes release notes or which checks their review requires. Do not invent them. Offer the candidates the conversation or the user's files suggest as options; when there are none, ask without options, and the user answers by typing.

Decide the rest without asking, and say what you assumed when you report the save:

- **Name**: a short, recognizable name for the kind of work.
- **Files**: a single `SKILL.md`. Add a script or reference file next to it only when the procedure needs one, such as a long template or a program it runs.
- **Who starts it**: the agent loads it on its own when a task matches. Add `disable-model-invocation: true` only when the user wants the skill to start only when they pick it with `/` in the composer.

Ask about the open ones with the `ask_user` tool, one question per call. Give `options` where you can: short concrete answers the user can pick as they are, the one you recommend first. Ask the most consequential question first, ask at most three, and drop any question an earlier answer settles. If the user skips a question, use the option you recommended, or leave that detail out of the procedure when there was none, and mention it when you report the save. Then save without showing a draft. An update asks only about what the requested change leaves open.

## The skill file

```markdown
---
name: <name>
description: <when it applies; what it does not cover>
---

<how to carry out the work>
```

- **name** — at most 128 characters matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`, the same as its folder name.
- **description** — the kind of work it is for first, then what it does not cover, on one line. The agent sees only the first 250 characters, so keep it within them; the file accepts at most 1024. Describe the intent and conditions, not phrases a user might type.
- **body** — the procedure, written so it works in any later task without this conversation: what to do, in what order, the user's conventions, and what a finished result looks like.

## Save

Write `<skillsDir>/<name>/SKILL.md` with the write tool. Depending on the task's approval setting, the save may not ask the user to confirm it, so after writing, report in one or two lines what was saved and where, and the defaults you assumed. The skill is listed from the user's next message.

To create a skill whose name is already taken by another skill under `skillsDir`, do not write over it: choose another name, or, when the request may mean that skill, ask whether to change it instead.

To update an existing skill, which the user's request names or plainly points at:

- Read `<skillsDir>/<name>/SKILL.md` and any files it references before changing anything.
- Change only what the user asks; keep the folder name and the frontmatter `name`.
- Save with the edit or write tool at the same path. The request to change it is the permission to overwrite it; do not ask again.

Rules:

- Do not create or change a skill under the name of a built-in skill: `create-skill`, `create-subagent`, `create-mcp`, `create-memory`, `create-command`, `create-automation`, `create-app`, `plan-mode` or `grill-me`. Offer a new skill under another name instead.
- Refuse any path outside the resolved `skillsDir`. This catalog does not authorize writing elsewhere in the service data directory or under `~/.pi`.
- Use the write and edit tools; keep the skill self-contained and practical.
- Do not put secrets such as passwords, tokens or keys into a skill.
