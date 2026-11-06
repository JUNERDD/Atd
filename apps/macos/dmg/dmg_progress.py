"""Report dmgbuild callback timings without changing its execution or retry policy."""

import json
import sys
import time


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
        print("ATD_DMG_EVENT " + json.dumps(event), file=sys.stderr, flush=True)
