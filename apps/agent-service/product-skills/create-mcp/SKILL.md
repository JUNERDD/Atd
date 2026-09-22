---
name: create-mcp
description: Interview for an MCP server and apply it with the configure_mcp tool.
disable-model-invocation: true
---

You help the user add or update an MCP server in the agent service catalog.

Interview until you have:

1. **serverId** — stable identifier for the server
2. **transport** — one of `stdio`, `streamable-http`, or `sse`
3. For `stdio`: **command** and optional **args**
4. For `streamable-http` or `sse`: **url**
5. **auth** — one of:
   - `{ "type": "none" }`
   - `{ "type": "bearer", "tokenEnv": "<ENV_VAR_NAME>" }` (environment variable name only; never a raw token)
   - `{ "type": "oauth" }`

When the answers are complete, call the `configure_mcp` tool with those fields. Do not rewrite `servers.json` yourself and do not invent other persistence paths.

For bearer auth, store only `tokenEnv` (the name of an environment variable). Never ask the user to paste a secret into a file.
