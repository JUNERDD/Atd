# macOS reset details

## Identity and storage ownership

| Object            | Production                                   | Development to preserve                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Bundle ID         | `com.junerdd.ai`                             | `com.junerdd.ai.dev`                                                     |
| Service directory | `~/Library/Application Support/AgentService` | `~/Library/Application Support/AgentService Dev`                         |
| Product home      | `~/.atd`                                     | `atd` inside the development service directory, or its explicit override |
| Keychain service  | `ai-agent-service:<production serviceId>`    | `ai-agent-service:<development serviceId>`                               |

Read `serviceId` from `service.json` before deleting the directory. This namespace contains provider, MCP, and plugin credentials. Use `security ... -s` with the exact service, without reading or printing passwords or exporting the keychain.

The fixed allowlist in `reset_atd.py` covers production service/product directories, `com.junerdd.ai` Application Support / Caches / Preferences / WebKit / HTTPStorages / Saved Application State, production logs, widget data, and application scripts. For containers, remove only `Data`; preserve system `.com.apple.containermanagerd.metadata.plist` files and protected container shells.

Legacy candidates include `AI`, `Atd`, and `Ask to Do Anything` under Application Support / Caches, plus `AI Safe Storage`, `Atd Safe Storage`, and `Ask to Do Anything Safe Storage` keychain services. The helper gates `AI` directories and legacy encryption credentials behind `--include-legacy-ai`. Establish ownership from installed app identity, project storage implementation, and directory structure before enabling it. Similar names alone are insufficient. Do not read user task content to establish ownership.

If explicit data/product directory overrides or storage implementation differ from these defaults, identify ownership before adjusting the allowlist. Do not infer production storage from another task's or development instance's environment. Preserve source repositories, user workspaces, other AI apps, browser authentication, and cloud account data.

## Running production processes

The helper identifies app and bundled-service processes by executable paths inside verified installations, sends SIGTERM, and waits for exit. It does not use `killall Atd` or fuzzy name matching. A production `endpoint.json` naming a live process outside those paths blocks cleanup until ownership is checked; the PID may have been reused.

An isolated Release instance from another task can also use `com.junerdd.ai`, so bundle identity alone is insufficient. Preserve development and other tasks' instances. If the user restarts the app during cleanup, stop deletion, recheck ownership, and explain the current state.

## Permissions

- Run `tccutil reset All com.junerdd.ai` before removing the app, and retain its exit code and output. It covers that app's TCC approvals, including applicable Screen Recording, Accessibility, Microphone, and Automation grants. Never omit the bundle ID and reset all apps.
- The widget ID is `com.junerdd.ai.widgets`. `No such bundle identifier` only means the tool cannot resolve an independent registration; it does not establish that widget grants were reset. Record it without expanding to development or global resets.
- If the main app was already uninstalled and TCC cannot resolve its identity, do not report success. A verified official bundle can supply temporary LaunchServices registration for the scoped reset; undo that registration and detach the volume afterwards. Do not launch the app, edit TCC databases, or disable security protections.
- Notifications and login/background items are outside TCC. Inspect only exact production bundle entries in `~/Library/Preferences/com.apple.ncprefs.plist` and exact production identities/installation paths in `sfltool dumpbtm`. Do not expose unrelated application records.
- Handle existing production notification or login/background grants through the old app's settings or supported system settings. Turning notifications off differs from restoring a never-asked state; disclose when supported controls cannot restore the latter. Do not clear the whole notifications plist, reset every background item, or stop unrelated services.

## Failures and verification

The helper deletes known credentials before removing their service identity directory, so an interrupted run does not discard the only keychain lookup identifier first. Read completed phases from the private report and continue from actual state after a failure. Do not replay machine-wide permission or keychain resets.

Verify that removal targets are absent, exact credential lookups return not found, production processes are stopped, old apps are in Trash, and development service/settings markers were preserved. The user may modify development settings concurrently; changed markers require investigation, not restoring or overwriting their data.

A missing service identity does not prove every historical namespace was removed. Report protected container metadata, unreadable system records, or disabled-but-retained notification entries separately from completed application data cleanup.
