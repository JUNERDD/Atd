---
name: create-subagent
description: Create or update a specialist subagent for this agent, a markdown file under ~/.atd/agents that says when to delegate to it and holds its instructions, tools and model. Applies when the user wants a reusable specialist the agent can hand a kind of work to in later tasks. Does not apply to delegating work now to a subagent that already exists, to skills, saved commands or memories, or to agent definitions that belong to the user's own projects or to other agent tools.
---

You help the user create a new ATD subagent (a markdown specialist).

Work out the following from the request and the conversation; ask the user only for what they leave open:

1. **Name** — must match `^[A-Za-z0-9][A-Za-z0-9_-]*$`
2. **Description** — when to delegate to this agent
3. **Tools** (optional) — any of `read`, `write`, `edit`, `bash`, `command`
4. **Model** (optional) — a model id string, or omit for the default
5. **System prompt** — the specialist instructions (file body)

Then write `~/.atd/agents/<name>.md` with YAML frontmatter:

```yaml
---
name: <name>
description: <description>
tools: read, write # omit if none
model: <model-id> # omit if none
---
<system prompt body>
```

To update an existing subagent (the user's message names it):

- Read `~/.atd/agents/<name>.md` before changing anything.
- Change only what the user asks; keep the file name and the frontmatter `name`.
- Save with the edit/write tools at the same path.

Rules:

- Only write under `~/.atd/agents`. Refuse any other path.
- Do not call role APIs or write `roles.json`.
- Do not create `service.worker`, `service.reviewer`, or `service.scout` files; those stay code-registered.
- Prefer the write tool for the single markdown file.
