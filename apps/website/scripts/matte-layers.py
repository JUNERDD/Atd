#!/usr/bin/env python3
"""Cut the interface scenes into layers that restack onto one shared desktop.

Every scene in the Interfaces carousel is the canonical desktop with application surfaces on top.
Most of those surfaces are glass: they blur the wallpaper behind them, so a surface exported on its
own (transparent background) has lost the blur, and the website could not animate surfaces
separately from a flat scene export. This script recovers each surface as a straight-alpha layer
from Figma renders instead.

Input: the layer sheets in Figma ("W · Website · Interface scene layers (matte exports)"), listed
with their layers in scripts/case-layers.json and exported as PNG at 2x into one directory, each
file named after its sheet node (`2553-144605.png`). A sheet row holds two cells: the scene
composited through that layer (later layers at zero opacity, so auto layout never reflows) and the
layer alone on a transparent canvas, whose alpha is the layer's own coverage including shadows.

For layer k over the composite below it (B = composite k-1, the desktop for the first layer) and
the composite through it (C), the layer is the most transparent straight-alpha image L, alpha a,
with a*L + (1-a)*B = C and a at least the layer's own coverage:
  a_min = max over channels of (C-B)/(1-B) where C > B and (B-C)/B where C < B
  a     = max(coverage, a_min) inside the coverage, 0 outside
  L     = (C - (1-a)*B) / a
At rest the stack reproduces the scene; in motion a glass surface stays as opaque as its own
coverage and carries the blur it had in place.

Run from the repository root (needs python3 with numpy and Pillow built with WebP):
  python3 apps/website/scripts/matte-layers.py <sheets-dir>
It writes public/cases/layers/ (the desktop and one WebP per layer, cropped to its box),
src/content/case-layers.ts and src/sections/cases/case-layers.css (formatted with oxfmt), then
recomposites the decoded WebP files and prints each scene's error against its Figma composite.
Layers without glass come out as their exact alone export; only glass layers need the matte.
"""

import argparse
import json
import pathlib
import shutil
import subprocess

import numpy as np
from PIL import Image

WEBSITE = pathlib.Path(__file__).resolve().parents[1]
SPEC = WEBSITE / 'scripts' / 'case-layers.json'
OUT = WEBSITE / 'public' / 'cases' / 'layers'
TS = WEBSITE / 'src' / 'content' / 'case-layers.ts'
CSS = WEBSITE / 'src' / 'sections' / 'cases' / 'case-layers.css'

SCALE = 2
W, H = 1440 * SCALE, 900 * SCALE
GAP = 200 * SCALE
PER_SHEET = 4
QUALITY = 92


def load(path):
    return np.asarray(Image.open(path).convert('RGBA'), dtype=np.float64) / 255


def cell(sheet, row, alone):
    x, y = (W + GAP) * alone, (H + GAP) * row
    return sheet[y : y + H, x : x + W]


def matte(base, comp, alone):
    """The layer over `base` that reproduces `comp`, and whether it needed more than `alone`."""
    b, c, coverage = base[..., :3], comp[..., :3], alone[..., 3]
    up = np.where(c > b, (c - b) / np.maximum(1 - b, 1e-9), 0)
    down = np.where(c < b, (b - c) / np.maximum(b, 1e-9), 0)
    a_min = np.max(np.maximum(up, down), axis=-1)
    a = np.where(coverage > 0, np.clip(np.maximum(coverage, a_min), 0, 1), 0)
    # Without glass the layer alone over the base already gives the composite: keep that exact
    # export, whose color is not divided by a small alpha and carries no amplified rounding noise.
    k = coverage[..., None]
    miss = np.abs(alone[..., :3] * k + b * (1 - k) - c).max(axis=-1)[coverage > 0]
    if np.percentile(miss, 99.5) <= 4 / 255:
        return alone * (coverage > 0)[..., None], False
    rgb = np.clip((c - (1 - a[..., None]) * b) / np.maximum(a, 1e-9)[..., None], 0, 1)
    rgb[a == 0] = 0
    return np.dstack([rgb, a]), True


def over(base, layer, x, y):
    out = base.copy()
    h, w = layer.shape[:2]
    a = layer[..., 3:4]
    out[y : y + h, x : x + w, :3] = layer[..., :3] * a + out[y : y + h, x : x + w, :3] * (1 - a)
    return out


def box(alpha):
    ys, xs = np.nonzero(alpha > 0)
    # Even edges keep every box on whole 1x pixels.
    x0, y0 = max(xs.min() - 2, 0) // 2 * 2, max(ys.min() - 2, 0) // 2 * 2
    x1, y1 = -(-min(xs.max() + 3, W) // 2) * 2, -(-min(ys.max() + 3, H) // 2) * 2
    return x0, y0, x1, y1


def save(array, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray(np.round(array * 255).astype(np.uint8))
    image.save(path, 'WEBP', quality=QUALITY, alpha_quality=100, method=6)
    return load(path)


def pct(value, whole):
    return f'{value / whole * 100:.4f}'.rstrip('0').rstrip('.') + '%'


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('sheets', type=pathlib.Path, help='directory of the 2x sheet exports')
    sheets_dir = parser.parse_args().sheets
    spec = json.loads(SPEC.read_text())
    sheet = lambda node: load(sheets_dir / (node.replace(':', '-') + '.png'))

    # The script owns the layer directory: renamed or removed layers must not linger.
    shutil.rmtree(OUT, ignore_errors=True)
    desktop = sheet(spec['desktop']['sheet'])[:H, :W, :3]
    desktop_out = save(desktop, OUT / 'desktop.webp')[..., :3]
    ts = [
        '// Generated by scripts/matte-layers.py from the Figma layer sheets. Do not edit by hand.',
        "import { mediaUrl } from './media';",
        '',
        '/** One layer of an interface scene, at 2x, positioned by case-layers.css. */',
        'export interface CaseLayer {',
        '  id: string;',
        '  src: string;',
        '  width: number;',
        '  height: number;',
        '}',
        '',
        f"export const caseDesktop = {{ src: mediaUrl('/cases/layers/desktop.webp'), width: {W}, height: {H} }};",
        '',
        '/** Each scene\'s layers, bottom to top. */',
        'export const caseLayers = {',
    ]
    css = [
        '/* Generated by scripts/matte-layers.py: each layer\'s box on the 1440 × 900 scene. */',
    ]
    total = (OUT / 'desktop.webp').stat().st_size
    for scene_id, scene in spec['scenes'].items():
        rows = [(image, row) for image in map(sheet, scene['sheets']) for row in range(PER_SHEET)]
        base = desktop
        stack = desktop_out
        ts.append(f"  '{scene_id}': [")
        for index, (name, _nodes) in enumerate(scene['layers']):
            image, row = rows[index]
            comp = cell(image, row, 0)
            layer, glass = matte(base, comp, cell(image, row, 1))
            stray = np.abs(comp[..., :3] - base[..., :3]).max(axis=-1)[layer[..., 3] == 0].max()
            x0, y0, x1, y1 = box(layer[..., 3])
            file = f'{index + 1}-{name}.webp'
            decoded = save(layer[y0:y1, x0:x1], OUT / scene_id / file)
            total += (OUT / scene_id / file).stat().st_size
            stack = over(stack, decoded, x0, y0)
            base = comp[..., :3]
            ts.append(
                f"    {{ id: '{name}', src: mediaUrl('/cases/layers/{scene_id}/{file}'), "
                f'width: {x1 - x0}, height: {y1 - y0} }},'
            )
            css.append(
                f".cases__layer[data-layer='{scene_id}/{name}'] {{\n"
                f'  inset-inline-start: {pct(x0, W)};\n  inset-block-start: {pct(y0, H)};\n'
                f'  inline-size: {pct(x1 - x0, W)};\n}}'
            )
            print(f'{scene_id}/{name}: {"glass" if glass else "flat"} {x1 - x0}x{y1 - y0} at {x0},{y0}; outside coverage {stray * 255:.1f}/255')
        ts.append('  ],')
        error = np.abs(stack - base) * 255
        print(f'{scene_id}: restacked error mean {error.mean():.2f}, p99.9 {np.percentile(error, 99.9):.1f}, max {error.max():.0f}')
    ts += ['} satisfies Record<string, readonly CaseLayer[]>;', '']
    TS.write_text('\n'.join(ts))
    CSS.write_text('\n'.join(css) + '\n')
    subprocess.run(['pnpm', 'exec', 'oxfmt', TS, CSS], cwd=WEBSITE.parents[1], check=True)
    print(f'total {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
