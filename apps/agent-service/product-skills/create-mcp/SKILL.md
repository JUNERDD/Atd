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

To update an existing server (the user's message names its serverId):

- `configure_mcp` replaces the transport, command/args or url, and auth of that serverId with what you send. It keeps the server's stdio env/cwd, HTTP headers, and OAuth scope/redirect for the same kind of transport, and drops them when you switch between stdio and HTTP; tell the user when that matters. Start from the server's current configuration; ask the user for any current value you cannot see instead of guessing.
- You never see env or header values, and the tool result reports only the serverId, revision, and whether the server is disabled. A new command for a server with env vars, or a URL on another origin for a server with headers or bearer auth, is refused so kept secrets never move; tell the user to remove the server and add it again in Settings instead.
- Change only what the user asks and call `configure_mcp` with the same `serverId`.

For bearer auth, store only `tokenEnv` (the name of an environment variable). Never ask the user to paste a secret into a file.
