"""Supervise one dmgbuild process and clean up only the images it creates."""

import json
import os
from pathlib import Path
import plistlib
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time


EVENT_PREFIX = "ATD_DMG_EVENT "
# Leave room for process termination and disk cleanup before CI's 12-minute step ceiling.
BUILD_TIMEOUT = 9 * 60
PHASE_TIMEOUTS = {
    "hdiutil::create": 120,
    "hdiutil::attach": 60,
    "hdiutil::detach": 60,
    "hdiutil::resize": 120,
    "hdiutil::convert": 300,
}


class Progress:
    """Emit dmgbuild's public callback events with monotonic phase durations."""

    def __init__(self):
        self.started = time.monotonic()
        self.phases = {}

    def __call__(self, info):
        now = time.monotonic()
        event_type = info["type"]
        name = info.get("operation", info.get("command", "build"))
        event = {
            "event": event_type,
            "phase": name,
            "elapsedSeconds": round(now - self.started, 3),
        }
        key = (event_type.split("::")[0], name)
        if event_type.endswith(("::start", "::started")):
            self.phases[key] = now
        elif event_type.endswith("::finished") and key in self.phases:
            event["durationSeconds"] = round(now - self.phases.pop(key), 3)
        # dmgbuild 1.6.5 spells the detach result's key "ret:"; other commands use "ret".
        result = info.get("ret", info.get("ret:"))
        if result is not None:
            event["returnCode"] = result
        if event_type == "error::fatal":
            event["message"] = info["message"]
        print(EVENT_PREFIX + json.dumps(event), flush=True)


def stop_worker(process):
    """Terminate the worker's whole session, including a blocked hdiutil/ditto child."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    finally:
        # The worker may have exited while one of its descendants still holds the image.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=5)


def cleanup_images(work_dir):
    """Find this invocation's images by backing-file directory, even if attach hung."""
    result = subprocess.run(
        ["/usr/bin/hdiutil", "info", "-plist"],
        check=True,
        capture_output=True,
        timeout=15,
    )
    deadline = time.monotonic() + 60
    for image in plistlib.loads(result.stdout)["images"]:
        image_path = image.get("image-path")
        if not image_path or Path(image_path).resolve().parent != work_dir:
            continue
        devices = {
            entity["dev-entry"]
            for entity in image["system-entities"]
            if "mount-point" in entity and "dev-entry" in entity
        }
        # An interrupted attach may have created a device without mounting a filesystem.
        if not devices:
            devices = {
                entity["dev-entry"]
                for entity in image["system-entities"][:1]
                if "dev-entry" in entity
            }
        for device in devices:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("DMG cleanup exceeded 60 seconds")
            print(f"DMG cleanup: detaching owned device {device}", file=sys.stderr, flush=True)
            subprocess.run(
                ["/usr/bin/hdiutil", "detach", "-force", device],
                check=True,
                timeout=min(20, remaining),
                stdout=sys.stderr,
            )


def watch_worker(process):
    started = time.monotonic()
    phase = "worker startup"
    phase_deadline = started + 120
    pending = b""
    stream_open = True
    while stream_open:
        now = time.monotonic()
        if now >= min(started + BUILD_TIMEOUT, phase_deadline):
            raise TimeoutError(
                f"DMG timed out during {phase}; total elapsed {now - started:.1f}s"
            )
        readable, _, _ = select.select([process.stdout], [], [], 0.5)
        if not readable:
            if process.poll() is not None:
                break
            continue
        chunk = os.read(process.stdout.fileno(), 65536)
        if not chunk:
            stream_open = False
        pending += chunk
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            line = line.decode("utf-8", errors="replace")
            print(line, file=sys.stderr, flush=True)
            if not line.startswith(EVENT_PREFIX):
                continue
            event = json.loads(line[len(EVENT_PREFIX):])
            name = event["phase"]
            if event["event"].endswith(("::start", "::started")):
                phase = name
                phase_deadline = time.monotonic() + PHASE_TIMEOUTS.get(name, 300)
            elif event["event"].endswith("::finished"):
                # Includes the sync between dmg::create and the first detach, which has no
                # callback of its own in dmgbuild 1.6.5. It must not wait indefinitely either.
                phase = f"after {name}"
                phase_deadline = time.monotonic() + 120
    if pending:
        print(pending.decode("utf-8", errors="replace"), file=sys.stderr, flush=True)
    remaining = min(started + BUILD_TIMEOUT, phase_deadline) - time.monotonic()
    result = process.wait(timeout=max(0.1, remaining))
    if result != 0:
        raise RuntimeError(f"dmgbuild exited with status {result} during {phase}")


def run_dmg(script, arguments):
    """Run the worker in an isolated staging directory; publish its DMG only on success."""
    output = Path(arguments[-1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix=".atd-dmg-", dir=output.parent)).resolve()
    staged = work_dir / output.name
    process = None
    succeeded = False

    def interrupted(signum, _frame):
        raise InterruptedError(f"DMG interrupted by signal {signum}")

    signals = (signal.SIGINT, signal.SIGTERM)
    handlers = {sig: signal.signal(sig, interrupted) for sig in signals}
    try:
        process = subprocess.Popen(
            [sys.executable, str(script), "--worker", *arguments[:-1], str(staged)],
            stdout=subprocess.PIPE,
            start_new_session=True,
        )
        watch_worker(process)
        os.replace(staged, output)
        succeeded = True
    except Exception as error:
        print(f"DMG failed: {error}", file=sys.stderr, flush=True)
        raise
    finally:
        # Bound cleanup independently; repeated cancellation must not interrupt a detach.
        for sig in signals:
            signal.signal(sig, signal.SIG_IGN)
        clean = succeeded
        try:
            if not succeeded:
                if process is not None:
                    stop_worker(process)
                cleanup_images(work_dir)
                clean = True
        except Exception as error:
            print(f"DMG cleanup failed; retained {work_dir}: {error}", file=sys.stderr, flush=True)
        finally:
            if process is not None and process.stdout is not None:
                process.stdout.close()
            if clean:
                shutil.rmtree(work_dir)
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
