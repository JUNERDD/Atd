"""Run dmgbuild and verify the app's signature inside the image before it is compressed.

dmgbuild 2.0 writes the background as an alias only, without the bookmark Finder on macOS 26
failed to resolve (dmgbuild/dmgbuild#273), so the image needs no .DS_Store correction.
"""

import argparse
import subprocess
from pathlib import Path

from dmgbuild import build_dmg

from dmg_progress import Progress


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app")
    parser.add_argument("background")
    parser.add_argument("layout")
    parser.add_argument("volume_name")
    parser.add_argument("output")
    args = parser.parse_args()
    mount_point = None
    progress = Progress()

    def remember_mount(path, _settings):
        nonlocal mount_point
        mount_point = Path(path)

    def on_progress(info):
        progress(info)
        # dmgbuild closes .DS_Store before this callback, then detaches and converts
        # the image. Exceptions here abort the build and dmgbuild unmounts it.
        if (
            info.get("type") == "operation::finished"
            and info.get("operation") == "dsstore::create"
        ):
            if mount_point is None:
                raise RuntimeError("dmgbuild did not provide the mounted image")
            # Layout metadata must not invalidate the signed app that users install.
            progress({"type": "operation::start", "operation": "codesign::verify"})
            subprocess.run(
                [
                    "codesign",
                    "--verify",
                    "--deep",
                    "--strict",
                    str(mount_point / Path(args.app).name),
                ],
                check=True,
            )
            progress({"type": "operation::finished", "operation": "codesign::verify"})

    build_dmg(
        args.output,
        args.volume_name,
        settings_file=str(Path(__file__).with_name("settings.py")),
        settings={"create_hook": remember_mount},
        defines={"app": args.app, "background": args.background, "layout": args.layout},
        callback=on_progress,
    )


if __name__ == "__main__":
    main()
