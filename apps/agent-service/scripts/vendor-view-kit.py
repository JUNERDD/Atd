#!/usr/bin/env python3
"""vendor-view-kit.py - vendor the apple-design web kit for generative views (`show_ui`).

Purpose: the agent service assembles every view document from the kit's tokens, block CSS and JS
(packages/agent-contracts/src/views.ts describes views). The service ships the kit as data instead
of running Python, so this script converts the kit once, with the kit's own build code
(.agents/skills/apple-design/scripts/build_kit.py): the same block headers and dependency
filtering, the same CSS and JS minifiers, and the same classic-script wrapping of the core JS
that `build_kit.py --minify --js` produces.

Inputs (the files that shape the outputs; source.inputsSha256 records them):
  .agents/skills/apple-design/assets/css/tokens.css
  .agents/skills/apple-design/assets/css/blocks/*.css
  .agents/skills/apple-design/assets/js/apple-interactions.js
  .agents/skills/apple-design/assets/js/blocks/*.js
  .agents/skills/apple-design/scripts/build_kit.py
inputsSha256 is the SHA-256 of `sha256sum`-style lines ("<file sha256>  <path>\n"), one per input,
sorted by the path relative to the skill directory.

Outputs (generated, never edit them by hand):
  apps/agent-service/view-kit/apple-kit.json
      kit data the service inlines into view documents
  apps/agent-service/product-skills/generative-ui/references/kit.md
      the agent's class and markup reference: `build_kit.py --markup` of every block

Rerun after any change to the inputs (from any directory):
  python3 apps/agent-service/scripts/vendor-view-kit.py
Python 3.9+, standard library only. The same inputs give byte-identical outputs, and an unchanged
output is not rewritten. Both files are laid out the way the repository formatter (oxfmt) prints
them, so `pnpm format:check` accepts them as generated.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import re
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve()
PRINT_WIDTH = 100  # oxfmt's default line width, which .oxfmtrc.json keeps
# A block name a view may request: KitBlockName in packages/agent-contracts/src/views.ts.
BLOCK_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")


def repository_root():
    for parent in SCRIPT.parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent
    raise SystemExit("error: no pnpm-workspace.yaml above %s" % SCRIPT)


REPO = repository_root()
KIT_JSON = REPO / "apps" / "agent-service" / "view-kit" / "apple-kit.json"
KIT_MD = REPO / "apps" / "agent-service" / "product-skills" / "generative-ui" / "references" / "kit.md"


def load_build_kit():
    path = REPO / ".agents" / "skills" / "apple-design" / "scripts" / "build_kit.py"
    sys.dont_write_bytecode = True  # importing must not leave a __pycache__ inside the skill
    spec = importlib.util.spec_from_file_location("build_kit", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_checked_blocks(bk):
    """The kit's blocks, refusing any the service could not serve: bad headers, names a view can't
    request, unknown requirements or cycles."""
    blocks = bk.load_blocks()
    problems = []
    for key, block in blocks.items():
        problems += ["%s: %s" % (block.path.name, message) for _, message in block.errors]
        if not BLOCK_NAME_RE.match(key):
            problems.append("%s: block name %r is not a valid view block name" % (block.path.name, key))
        try:
            bk.resolve([key], blocks)
        except ValueError as error:
            problems.append("%s: %s" % (block.path.name, error))
    if problems:
        raise SystemExit("error: the kit has problems (run build_kit.py --check):\n  " + "\n  ".join(problems))
    return blocks


def inputs_sha256(bk):
    files = [bk.TOKENS, *bk.BLOCK_DIR.glob("*.css"), bk.JS_CORE, *bk.JS_BLOCK_DIR.glob("*.js"), Path(bk.__file__)]
    entries = sorted((path.resolve().relative_to(bk.ROOT).as_posix(), path) for path in files)
    manifest = "".join("%s  %s\n" % (hashlib.sha256(path.read_bytes()).hexdigest(), rel) for rel, path in entries)
    return hashlib.sha256(manifest.encode("utf-8")).hexdigest()


def core_js(bk):
    """build_js with no blocks (export-stripped apple-interactions.js in an IIFE, minified), minus its
    leading /*! banner, which names a block set that is wrong for a view."""
    banner, _, body = bk.build_js([], minify=True).partition("\n")
    if not (banner.startswith("/*!") and banner.endswith("*/") and body.startswith("(() => {")):
        raise SystemExit("error: build_js output no longer starts with a banner line and the IIFE")
    return body.strip()


def block_js(bk, name):
    path = bk.JS_BLOCK_DIR / ("%s.js" % name)
    js = bk.read_text(path) if path.is_file() else None
    return bk.minify_js(js.strip()).strip() if js and js.strip() else ""


def kit_data(bk, blocks):
    tokens = bk.read_text(bk.TOKENS)
    if tokens is None:
        raise SystemExit("error: missing %s" % bk.TOKENS)
    return {
        "version": 1,
        "source": {"skill": ".agents/skills/apple-design", "inputsSha256": inputs_sha256(bk)},
        "layers": bk.LAYER_STATEMENT,
        "tokens": bk.minify_css(tokens.strip()),
        "coreJs": core_js(bk),
        "blocks": {
            name: {
                "requires": blocks[name].deps(),
                "layer": blocks[name].layer,
                "css": bk.minify_css(blocks[name].body.strip()),
                "js": block_js(bk, name),
            }
            for name in sorted(blocks)
        },
    }


def json_text(value, indent=0):
    """JSON as oxfmt prints it: every object one member per line; an array of scalars on the member's
    line when that line fits PRINT_WIDTH (its trailing comma included), else one item per line."""
    if not isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    pad = "  " * (indent + 1)
    members = []
    for index, (key, item) in enumerate(value.items()):
        head = "%s%s: " % (pad, json.dumps(key, ensure_ascii=False))
        comma = "," if index < len(value) - 1 else ""
        if isinstance(item, list):
            inline = "[%s]" % ", ".join(json.dumps(x, ensure_ascii=False) for x in item)
            scalars = all(not isinstance(x, (dict, list)) for x in item)
            if scalars and len(head + inline + comma) <= PRINT_WIDTH:
                text = inline
            else:
                rows = ",\n".join(pad + "  " + json_text(x, indent + 2) for x in item)
                text = "[\n%s\n%s]" % (rows, pad)
        else:
            text = json_text(item, indent + 1)
        members.append(head + text + comma)
    return "{\n%s\n%s}" % ("\n".join(members), "  " * indent) if members else "{}"


def markup_of(bk, blocks, name):
    """What `build_kit.py --markup <name>` prints, with trailing whitespace removed."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        status = bk.cmd_markup([name], blocks)
    if status != 0:
        raise SystemExit("error: build_kit.py --markup %s failed" % name)
    return "\n".join(line.rstrip() for line in out.getvalue().strip("\n").splitlines())


def fenced(text):
    """A text code block (Markdown never reformats its content), fenced like oxfmt would fence it."""
    fence = "```"
    while fence in text:
        fence += "`"
    return "%stext\n%s\n%s" % (fence, text, fence)


def kit_markdown(bk, blocks):
    names = sorted(blocks)
    requires = {name: ", ".join(blocks[name].deps()) or "—" for name in names}
    name_width = max(len(name) for name in names)
    requires_width = max(len(text) for text in requires.values())
    index = "\n".join("%-*s  %-*s  %s" % (name_width, name, requires_width, requires[name], blocks[name].purpose)
                      for name in names)
    parts = [
        "<!-- Generated by apps/agent-service/scripts/vendor-view-kit.py from .agents/skills/apple-design. "
        "Do not edit; rerun the script. -->",
        "# Kit markup reference",
        "This is the class and markup reference of the apple-design web kit that view documents embed. "
        "List the blocks a view uses in the `blocks` argument of `show_ui`; the blocks they require are "
        "added for you. The kit CSS itself is never read: write markup from these notes. The examples "
        "come from ordinary web pages, and nothing in a view loads from the network, so use inline SVG or "
        "`data:` URLs for images.",
        "## Blocks",
        "Name, required blocks, purpose:",
        fenced(index),
    ]
    for name in names:
        parts += ["## %s" % name, fenced(markup_of(bk, blocks, name))]
    return "\n\n".join(parts) + "\n"


def write_if_changed(path, text):
    data = text.encode("utf-8")
    if path.is_file() and path.read_bytes() == data:
        return "unchanged"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return "wrote"


def main():
    bk = load_build_kit()
    blocks = load_checked_blocks(bk)
    outputs = [(KIT_JSON, json_text(kit_data(bk, blocks)) + "\n"), (KIT_MD, kit_markdown(bk, blocks))]
    for path, text in outputs:
        status = write_if_changed(path, text)
        print("%s %s (%d bytes)" % (status, path.relative_to(REPO).as_posix(), len(text.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
