#!/usr/bin/env python3
"""WCAG contrast checker for Apple-style UIs (CON-1, CON-2, COL-3). Python 3.9+, stdlib only.

Usage:
  python3 contrast.py FG BG                      # ratio + pass/fail for text, large text, glyphs
  python3 contrast.py "rgba(60,60,67,.6)" "#F2F2F7"   # translucent label composited over its background
  python3 contrast.py "#FFFFFF" "rgba(255,255,255,.53)" --over "#7A2E8E"   # text on glass over a backdrop
  python3 contrast.py --on "#FFCC00"             # which label (white or near-black) works on a fill
  python3 contrast.py FG BG --size 17 --bold     # judge against the threshold for that text size
                                                 # (HIG/CON-1: 3:1 from 18 pt or any bold; --wcag: 24 px, or 18.66 px bold)

Colors: #RGB, #RRGGBB, #RRGGBBAA, rgb(r,g,b), rgba(r,g,b,a), white, black.
A translucent BG needs --over (the backdrop it sits on). Glass is approximated as its fill
composited over the worst-case backdrop; blur and saturation are not modelled, so sample
the rendered pixels when the backdrop is busy.
"""
import argparse
import re
import sys

NAMED = {"white": (255, 255, 255, 1.0), "black": (0, 0, 0, 1.0)}
DARK_LABEL = (0, 0, 0, 1.0)  # iOS label in light mode is #000000


def parse(s):
    s = s.strip().lower()
    if s in NAMED:
        return NAMED[s]
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})", s)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (r, g, b, a)
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)", s)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3))
        a = m.group(4)
        alpha = 1.0 if a is None else (float(a[:-1]) / 100 if a.endswith("%") else float(a))
        return (r, g, b, alpha)
    raise ValueError(f"unrecognized color: {s!r}")


def over(fg, bg):
    """Composite fg (with alpha) over an opaque bg."""
    a = fg[3]
    return tuple(fg[i] * a + bg[i] * (1 - a) for i in range(3)) + (1.0,)


def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def hexstr(c):
    return "#%02X%02X%02X" % tuple(round(v) for v in c[:3])


def main(argv=None):
    p = argparse.ArgumentParser(description="WCAG contrast for Apple-style UIs")
    p.add_argument("fg", nargs="?", help="foreground (text/glyph) color")
    p.add_argument("bg", nargs="?", help="background color (may be translucent with --over)")
    p.add_argument("--over", help="opaque backdrop under a translucent background (e.g. glass over content)")
    p.add_argument("--on", metavar="FILL", help="suggest white or dark label for this fill")
    p.add_argument("--size", type=float, help="text size (HIG pt by default; CSS px with --wcag)")
    p.add_argument("--bold", action="store_true")
    p.add_argument("--wcag", action="store_true", help="WCAG large-text rule for web (24 px, or 18.66 px bold)")
    args = p.parse_args(argv)

    if args.on:
        fill = parse(args.on)
        if fill[3] < 1:
            if not args.over:
                p.error("translucent --on fill needs --over")
            fill = over(fill, parse(args.over))
        w, k = ratio(NAMED["white"], fill), ratio(DARK_LABEL, fill)
        best = "white" if w >= k else "dark (#000000 / label)"
        print(f"fill {hexstr(fill)}: white {w:.2f}:1, dark {k:.2f}:1 -> use {best} "
              f"({'passes' if max(w, k) >= 4.5 else 'FAILS'} 4.5:1 text; "
              f"{'passes' if max(w, k) >= 3 else 'FAILS'} 3:1 glyphs)")
        return 0

    if not (args.fg and args.bg):
        p.error("give FG and BG, or --on FILL")
    bg = parse(args.bg)
    if bg[3] < 1:
        if not args.over:
            p.error("translucent BG needs --over BACKDROP")
        bg = over(bg, parse(args.over))
    fg = parse(args.fg)
    if fg[3] < 1:
        fg = over(fg, bg)
    r = ratio(fg, bg)
    if args.size is None:
        large = False
    elif args.wcag:
        large = args.size >= 24 or (args.bold and args.size >= 18.66)
    else:  # HIG Accessibility table, mirrored by CON-1: 18 pt and up, or any bold text
        large = args.size >= 18 or args.bold
    need = 3.0 if large else 4.5
    verdict = lambda ok: "pass" if ok else "FAIL"
    print(f"{hexstr(fg)} on {hexstr(bg)}: {r:.2f}:1")
    print(f"  text (4.5:1): {verdict(r >= 4.5)}   large/bold text (3:1): {verdict(r >= 3)}   glyphs/UI (3:1): {verdict(r >= 3)}")
    if args.size is not None:
        print(f"  at {args.size:g}{' bold' if args.bold else ''}: needs {need:g}:1 -> {verdict(r >= need)}")
    return 0 if r >= need else 1


if __name__ == "__main__":
    sys.exit(main())
