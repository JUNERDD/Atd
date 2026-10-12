---
name: create-mcp
description: The user wants the agent to gain or adjust tools served over MCP, naming a server, package, URL or only a capability. Not for using a connected server's tools, removing or approving one (Settings › Extensions), or MCP work in their own projects.
---

You help the user add or update an MCP server in the agent service catalog.

Start with `list_mcp_servers`: it shows the servers already configured, so you neither add a duplicate nor need any configuration file.

Work out the following from the request, the server's own documentation, and what you can check on this computer. For a published server, take the launch command or URL its documentation gives.

1. **serverId** — stable identifier for the server
2. **transport** — one of `stdio`, `streamable-http`, or `sse`
3. For `stdio`: **command** and optional **args**
4. For `streamable-http` or `sse`: **url**
5. **auth** — one of:
   - `{ "type": "none" }`
   - `{ "type": "bearer", "tokenEnv": "<ENV_VAR_NAME>" }` (environment variable name only; never a raw token)
   - `{ "type": "oauth" }`

If the server only reads or writes files inside directories it is configured with, add its own option for that directory (such as `--workspace`) to the args, set to the tasks folder the `configure_mcp` tool description names. That folder holds every task's folder, because one connection serves every task. Never add an option that lifts the server's path restriction.

## Settle the open choices

The serverId is yours to choose, and the command, args and URL come from the documentation; never ask the user for them. Two choices can be open, and only these are worth a question:

- **Which server**, when the user names only a capability. Look up servers that provide it and offer the ones you found as concrete candidates, the one you recommend first: prefer the service's own official server, then a widely used, maintained one.
- **How a remote server signs in**, when its documentation does not settle whether it takes no authentication, a bearer token or OAuth.

Ask about an open one with the `ask_user` tool, one question per call, with `options`: short concrete answers the user can pick as they are, the one you recommend first. Ask at most two, and drop the second when the first answer settles it. If the user skips a question, use the option you recommended and mention it when you report the save.

Never ask the user to paste a token, key or password into the chat or into a file: `configure_mcp` stores no secret values, only the name of the environment variable a bearer token is read from. For bearer auth, choose that name from the server's documentation, or a clear one such as `GITHUB_TOKEN`.

## Save

When the settings are complete, call the `configure_mcp` tool with those fields, without showing a draft first. It asks the user to confirm with a plain summary of what it will save: whether it adds or changes the server, the transport, the command or URL, the auth with its token variable, and for a change what it replaces. So do not ask a second time. When the user declines, nothing is saved: ask what they want different. The tool writes the catalog itself: do not look for or edit MCP configuration files, and do not invent other persistence paths.

Relay what its result says, including when the user must approve the server before it can run, from the approval banner under that step or in Settings › Extensions.

After saving a server with bearer auth, tell the user the exact variable name (`tokenEnv`) and that they set it themselves: the service reads the token from its own environment each time it connects, and it inherits that environment when Atd starts it. A variable exported only in a shell profile does not reach Atd opened from the Dock or Finder, so they set it for apps the Mac opens, for example with `launchctl setenv` in Terminal, and then quit and reopen Atd.

## Update an existing server

When the user's message names a server's serverId:

- `configure_mcp` replaces the transport, command/args or url, and auth of that serverId with what you send. It keeps the server's stdio env/cwd, HTTP headers, and OAuth scope/redirect for the same kind of transport, and drops them when you switch between stdio and HTTP; tell the user when that matters. Start from the server's current configuration as `list_mcp_servers` shows it.
- You never see env or header values: `list_mcp_servers` and the `configure_mcp` result show only their names. A new command for a server with env vars, or a URL on another origin for a server with headers or bearer auth, is refused so kept secrets never move; tell the user to remove the server and add it again in Settings instead.
- Change only what the user asks and call `configure_mcp` with the same `serverId`. Ask only about what the requested change leaves open.
