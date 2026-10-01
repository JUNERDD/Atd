---
name: create-mcp
description: Add an MCP server to this agent or change one it already has, by working out its settings and applying them with the configure_mcp tool. Applies whenever the user wants the agent to gain or adjust tools served over MCP, whether they name a server, a package, a URL or only the capability they want connected. Does not apply to using the tools of a server that is already connected, to removing or approving a server (the user does that in Settings › Extensions), or to MCP work in the user's own projects, such as writing an MCP server or editing another application's MCP configuration.
---

You help the user add or update an MCP server in the agent service catalog.

Start with `list_mcp_servers`: it shows the servers already configured, so you neither add a duplicate nor need any configuration file.

Work out the following from the request, the server's own documentation, and what you can check on this computer; ask the user only for what those leave open. For a published server, use the launch command or URL its documentation gives instead of asking the user for it.

1. **serverId** — stable identifier for the server
2. **transport** — one of `stdio`, `streamable-http`, or `sse`
3. For `stdio`: **command** and optional **args**
4. For `streamable-http` or `sse`: **url**
5. **auth** — one of:
   - `{ "type": "none" }`
   - `{ "type": "bearer", "tokenEnv": "<ENV_VAR_NAME>" }` (environment variable name only; never a raw token)
   - `{ "type": "oauth" }`

If the server only reads or writes files inside directories it is configured with, add its own option for that directory (such as `--workspace`) to the args, set to the tasks folder the `configure_mcp` tool description names. That folder holds every task's folder, because one connection serves every task. Never add an option that lifts the server's path restriction.

When the settings are complete, call the `configure_mcp` tool with those fields. It writes the catalog itself: do not look for or edit MCP configuration files, and do not invent other persistence paths. Relay what its result says, including when the user must approve the server before it can run, from the approval banner under that step or in Settings › Extensions.

To update an existing server (the user's message names its serverId):

- `configure_mcp` replaces the transport, command/args or url, and auth of that serverId with what you send. It keeps the server's stdio env/cwd, HTTP headers, and OAuth scope/redirect for the same kind of transport, and drops them when you switch between stdio and HTTP; tell the user when that matters. Start from the server's current configuration as `list_mcp_servers` shows it; ask the user only for what it cannot show, such as env or header values.
- You never see env or header values: `list_mcp_servers` and the `configure_mcp` result show only their names. A new command for a server with env vars, or a URL on another origin for a server with headers or bearer auth, is refused so kept secrets never move; tell the user to remove the server and add it again in Settings instead.
- Change only what the user asks and call `configure_mcp` with the same `serverId`.

For bearer auth, store only `tokenEnv` (the name of an environment variable). Never ask the user to paste a secret into a file.
