"""Run dmgbuild and correct its background bookmark before the image is compressed."""

import argparse
import struct
import subprocess
from pathlib import Path

from dmgbuild import build_dmg
from ds_store import DSStore
from mac_alias import (
    Data,
    URL,
    kBookmarkVolumePath,
    kBookmarkVolumeProperties,
    kBookmarkVolumeURL,
)
from mac_alias.bookmark import kCFURLVolumeIsDiskImage, kCFURLVolumeIsInternal


def fix_background_bookmark(mount_point):
    # mac-alias 2.2.2 marks every volume as internal. Finder cannot resolve the
    # volume-relative background path on a DMG with that flag (macOS 26).
    # Keep dmgbuild's volume identity and file IDs, but describe the actual volume.
    with DSStore.open(str(mount_point / ".DS_Store"), "r+") as store:
        bookmark = store["."]["pBBk"]
        flags, valid, reserved = struct.unpack(
            "<QQQ", bookmark[kBookmarkVolumeProperties].bytes
        )
        flags = (flags & ~kCFURLVolumeIsInternal) | kCFURLVolumeIsDiskImage
        valid |= kCFURLVolumeIsInternal | kCFURLVolumeIsDiskImage
        bookmark[kBookmarkVolumeProperties] = Data(
            struct.pack("<QQQ", flags, valid, reserved)
        )
        # The versioned volume name contains a space; file URLs must escape it.
        bookmark[kBookmarkVolumeURL] = URL(
            Path(bookmark[kBookmarkVolumePath]).as_uri() + "/"
        )
        store["."]["pBBk"] = bookmark


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app")
    parser.add_argument("background")
    parser.add_argument("layout")
    parser.add_argument("volume_name")
    parser.add_argument("output")
    args = parser.parse_args()
    mount_point = None

    def remember_mount(path, _settings):
        nonlocal mount_point
        mount_point = Path(path)

    def on_progress(info):
        # dmgbuild closes .DS_Store before this callback, then detaches and converts
        # the image. Exceptions here abort the build and dmgbuild unmounts it.
        if (
            info.get("type") == "operation::finished"
            and info.get("operation") == "dsstore::create"
        ):
            if mount_point is None:
                raise RuntimeError("dmgbuild did not provide the mounted image")
            fix_background_bookmark(mount_point)
            # Layout metadata must not invalidate the signed app that users install.
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
