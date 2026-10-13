#!/usr/bin/env python3
"""Recover transparent layer sheets from two flattened exports.

matte-layers.py needs each sheet with its transparency, but some export paths (the Figma MCP export
among them) flatten a frame onto what lies behind it. The sheets sit in a section filled with
#444444, so export each sheet twice at 2x: once as it is, over that gray, and once with a temporary
white fill on the sheet, then remove the fill. With gray g and white, every pixel's coverage and
color follow exactly, because the composites are linear in the backdrop:
  a = 1 - (white - gray) / (1 - g)      premultiplied color = white - (1 - a)
Figma's transparent export draws a background-blurred glass shape opaque, and matte-layers.py keeps
a layer at least as opaque as that coverage, so glass layers carry their blurred backdrop in motion.
The glass fill (80 %) and anything denser therefore counts as opaque coverage. A sheet with no white
export (the desktop, which is opaque) is copied as it is.

Run from the repository root (needs python3 with numpy and Pillow):
  python3 apps/website/scripts/unflatten-sheets.py <gray-dir> <white-dir> <out-dir>
then pass <out-dir> to matte-layers.py. Files keep their node names (`2553-145107.png`).
"""

import argparse
import pathlib

import numpy as np
from PIL import Image

GRAY = 0x44 / 255
GLASS = 0.75


def load(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('gray', type=pathlib.Path, help='sheets exported over the section gray')
    parser.add_argument('white', type=pathlib.Path, help='the same sheets exported on white')
    parser.add_argument('out', type=pathlib.Path, help='directory for the transparent sheets')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for gray_path in sorted(args.gray.glob('*.png')):
        white_path = args.white / gray_path.name
        if not white_path.exists():
            Image.open(gray_path).convert('RGBA').save(args.out / gray_path.name)
            print(f'{gray_path.name}: opaque, copied')
            continue
        gray, white = load(gray_path), load(white_path)
        a = np.clip(1 - (white - gray).mean(axis=-1) / (1 - GRAY), 0, 1)
        a[a < 0.5 / 255] = 0
        a[a >= GLASS] = 1
        premultiplied = np.clip(white - (1 - a)[..., None], 0, 1)
        rgb = np.clip(premultiplied / np.maximum(a, 1e-9)[..., None], 0, 1) * (a > 0)[..., None]
        # The channels must agree on the backdrop's share, or the pair does not composite linearly.
        spread = np.abs((white - gray) - (white - gray).mean(axis=-1, keepdims=True)).max() * 255
        image = np.round(np.dstack([rgb, a]) * 255).astype(np.uint8)
        Image.fromarray(image).save(args.out / gray_path.name)
        print(f'{gray_path.name}: channel spread {spread:.1f}/255')


if __name__ == '__main__':
    main()
