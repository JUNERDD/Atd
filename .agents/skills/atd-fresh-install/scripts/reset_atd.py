#!/usr/bin/env python3
"""Inspect an Atd production reset; mutate only with --apply and a private report."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import sys
import time
import uuid

BUNDLE = "com.junerdd.ai"
LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
LEGACY_KEYS = ["AI Safe Storage", "Atd Safe Storage", "Ask to Do Anything Safe Storage"]


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=False)


def safe_path(path):
    # A symlink in an ancestor could redirect deletion or identity reads into Dev data.
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f"Path ownership needs review (symlink): {part}")
    return path


def targets(home, legacy):
    paths = [home / "Library/Application Support/AgentService", home / ".atd"]
    folders = {
        "Application Support": [BUNDLE, "Atd", "Ask to Do Anything"],
        "Caches": [BUNDLE, BUNDLE + ".widgets", "Atd", "Ask to Do Anything"],
        "Preferences": [BUNDLE + ".plist", BUNDLE + ".widgets.plist"],
        "WebKit": [BUNDLE],
        "HTTPStorages": [BUNDLE, BUNDLE + ".binarycookies"],
        "Saved Application State": [BUNDLE + ".savedState"],
        "Logs": ["AI"],
        "Application Scripts": [BUNDLE, BUNDLE + ".widgets"],
    }
    if legacy:
        for folder in ("Application Support", "Caches"):
            folders[folder].append("AI")
    for folder, names in folders.items():
        paths.extend(home / "Library" / folder / name for name in names)
    paths.extend(home / "Library/Containers" / name / "Data" for name in (
        BUNDLE, BUNDLE + ".widgets", BUNDLE + ".pluginworker"
    ))
    return paths


def service_id(path):
    safe_path(path)
    if not path.exists():
        return None
    value = json.loads(path.read_text())["serviceId"]
    uuid.UUID(value)
    return value


def processes():
    result = run(["ps", "-axo", "pid=,comm="])
    if result.returncode:
        raise RuntimeError("Cannot inspect running processes")
    rows = [line.strip().split(None, 1) for line in result.stdout.splitlines()]
    return {int(row[0]): row[1] for row in rows if len(row) == 2}


def dev_markers(home):
    base = home / "Library/Application Support/AgentService Dev"
    return {
        name: hashlib.sha256((base / name).read_bytes()).hexdigest()
        if (base / name).exists() else None
        for name in ("service.json", "settings.json")
    }


def inventory(home, candidates, legacy=False, saved_ids=(), process_table=None):
    paths = targets(home, legacy)
    for path in paths:
        safe_path(path)
    apps = []
    for path in candidates:
        safe_path(path)
        if not path.exists():
            continue
        info = plistlib.loads((path / "Contents/Info.plist").read_bytes())
        if info.get("CFBundleIdentifier") != BUNDLE:
            raise ValueError(f"Not an official Atd application: {path}")
        if "Volumes" in path.parts or ".Trash" in path.parts:
            raise ValueError(f"Not an installed application: {path}")
        apps.append({"path": str(path), "version": info.get("CFBundleShortVersionString")})
    prod = home / "Library/Application Support/AgentService"
    ids = set(saved_ids)
    for value in ids:
        uuid.UUID(value)
    current_id = service_id(prod / "service.json")
    if current_id:
        ids.add(current_id)
    dev_id = service_id(home / "Library/Application Support/AgentService Dev/service.json")
    if dev_id in ids:
        raise ValueError("Production and development service identities overlap")
    table = processes() if process_table is None else process_table
    known_apps = {app["path"] for app in apps}
    for command in table.values():
        executable = Path(command)
        if executable.name not in ("Atd", "AI", "Ask to Do Anything") or executable.parent.name != "MacOS":
            continue
        running_app = executable.parents[2]
        info_file = running_app / "Contents/Info.plist"
        if info_file.exists() and str(running_app) not in known_apps:
            info = plistlib.loads(info_file.read_bytes())
            if info.get("CFBundleIdentifier") == BUNDLE:
                raise ValueError("Another official-bundle process is outside the selected installation; inspect its data directory")
    owned = {pid: command for pid, command in table.items()
             if any(command.startswith(app["path"] + "/") for app in apps)}
    endpoint = prod / "endpoint.json"
    if endpoint.exists():
        safe_path(endpoint)
        pid = json.loads(endpoint.read_text())["pid"]
        if pid in table and pid not in owned:
            raise ValueError("Production endpoint names a live process outside the installed app; inspect ownership")
    return {
        "home": str(home), "apps": apps, "data_paths": [str(p) for p in paths],
        "existing_data_paths": [str(p) for p in paths if p.exists()],
        "keychain_services": ["ai-agent-service:" + value for value in sorted(ids)]
        + (LEGACY_KEYS if legacy else []),
        "service_identity_found": bool(ids), "processes": owned,
        "dev_markers": dev_markers(home), "include_legacy_ai": legacy,
    }


def stop_owned(plan):
    for pid, expected in plan["processes"].items():
        current = processes().get(pid)
        if current is None:
            continue
        if current != expected:
            raise RuntimeError("Process identity changed; inspect again before stopping")
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 5
    while True:
        table = processes()
        live = [pid for pid, command in table.items()
                if any(command.startswith(app["path"] + "/") for app in plan["apps"])]
        if not live:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("Official processes did not exit; no data was deleted")
        time.sleep(0.1)


def assert_quiet(plan):
    table = processes()
    if any(command.startswith(app["path"] + "/")
           for command in table.values() for app in plan["apps"]):
        raise RuntimeError("The official app restarted; stop deletion and inspect")
    fresh = inventory(Path(plan["home"]), [Path(app["path"]) for app in plan["apps"]],
                      plan["include_legacy_ai"], process_table=table)
    if fresh["processes"]:
        raise RuntimeError("The official app restarted; stop deletion and inspect")
    if not set(fresh["keychain_services"]).issubset(plan["keychain_services"]):
        raise RuntimeError("Production service identity changed; inspect before deleting data")


def delete_credentials(service, runner):
    count = 0
    while count < 100:
        result = runner(["security", "delete-generic-password", "-s", service])
        if result.returncode == 44:
            return count
        if result.returncode:
            raise RuntimeError(f"Keychain deletion failed with status {result.returncode}")
        count += 1
    raise RuntimeError("Credential namespace did not become empty")


def apply_reset(plan, report_path, runner=run, stopper=stop_owned, quiet=assert_quiet):
    # This plan is generated in-process, never loaded from an editable deletion manifest.
    home = Path(plan["home"])
    report_path = Path(os.path.abspath(report_path))
    for root in [*plan["data_paths"], *[app["path"] for app in plan["apps"]]]:
        if Path(root) == report_path or Path(root) in report_path.parents:
            raise ValueError("The reset report must be outside all removal targets")
    safe_path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(report_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    report = {"status": "running", "inventory": plan, "phases": [], "permissions": {},
              "credentials_deleted": {}, "removed_paths": [], "trashed_apps": [], "limitations": []}
    with os.fdopen(fd, "w") as output:
        json.dump(report, output, indent=2)

    def save(phase):
        report["phases"].append(phase)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    try:
        stopper(plan)
        quiet(plan)
        save("official_processes_stopped")
        for bundle in (BUNDLE, BUNDLE + ".widgets"):
            result = runner(["tccutil", "reset", "All", bundle])
            report["permissions"][bundle] = {"status": result.returncode,
                                             "message": result.stdout.strip() or result.stderr.strip()}
            if result.returncode:
                if bundle == BUNDLE:
                    raise RuntimeError("Official app TCC reset failed; no data was deleted")
                report["limitations"].append("Widget TCC reset was not confirmed")
        save("tcc_reset_attempted")
        for service in plan["keychain_services"]:
            report["credentials_deleted"][service] = delete_credentials(service, runner)
        if not plan["service_identity_found"]:
            report["limitations"].append("Missing production service identity; historical keychain namespace is unknown")
        save("known_credentials_deleted")
        for app in plan["apps"]:
            widget = Path(app["path"]) / "Contents/PlugIns/AtdWidgets.appex"
            if widget.exists():
                result = runner(["pluginkit", "-r", str(widget)])
                if result.returncode:
                    report["limitations"].append("Widget unregistration was not confirmed")
        for bundle in (BUNDLE, BUNDLE + ".widgets"):
            result = runner(["defaults", "delete", bundle])
            if result.returncode and "not found" not in result.stderr.lower():
                raise RuntimeError(f"Cannot clear preferences for {bundle}")
        quiet(plan)
        for raw in plan["data_paths"]:
            path = safe_path(Path(raw))
            if not path.exists():
                continue
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            report["removed_paths"].append(raw)
        save("production_data_deleted")
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        for index, app in enumerate(plan["apps"]):
            source = safe_path(Path(app["path"]))
            result = runner([LSREGISTER, "-u", str(source)])
            if result.returncode:
                raise RuntimeError("Cannot unregister the old official app")
            trash = safe_path(home / ".Trash" / f"Atd-before-fresh-install-{stamp}-{index}")
            trash.mkdir(parents=True, exist_ok=False)
            destination = trash / source.name
            shutil.move(str(source), str(destination))
            report["trashed_apps"].append(str(destination))
        save("old_apps_trashed")
        quiet(plan)
        if any(Path(p).exists() for p in plan["data_paths"]):
            raise RuntimeError("Production data remains or was recreated")
        for service in plan["keychain_services"]:
            if runner(["security", "find-generic-password", "-s", service]).returncode != 44:
                raise RuntimeError("A credential remains or keychain verification failed")
        report["development_markers_unchanged"] = dev_markers(home) == plan["dev_markers"]
        if not report["development_markers_unchanged"]:
            report["limitations"].append("Development metadata changed; review without restoring it")
        report["limitations"].append("Notification and login item checks must be verified separately")
        report["status"] = "core_reset_complete"
        save("core_state_verified")
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        save("stopped_on_error")
        raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Execute an already-authorized production reset")
    parser.add_argument("--report", type=Path, help="New private JSON report path; required for --apply")
    parser.add_argument("--app", type=Path, action="append", help="Verified installed official app path")
    parser.add_argument("--service-id", action="append", default=[], help="Production identity saved earlier in this task")
    parser.add_argument("--include-legacy-ai", action="store_true", help="Include legacy AI data and safe-storage keys after ownership verification")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This workflow requires macOS")
    if args.apply and not args.report:
        parser.error("--apply requires --report")
    home = Path.home()
    candidates = args.app or [Path("/Applications/Atd.app"), home / "Applications/Atd.app"]
    if any(not p.is_absolute() for p in candidates):
        parser.error("--app must be an absolute path")
    plan = inventory(home, candidates, args.include_legacy_ai, args.service_id)
    if not args.apply:
        print(json.dumps({"mode": "read_only", **plan}, ensure_ascii=False, indent=2))
        return
    report = apply_reset(plan, args.report)
    print(json.dumps({"status": report["status"], "report": str(args.report),
                      "limitations": report["limitations"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Reset stopped: {error}", file=sys.stderr)
        sys.exit(1)
