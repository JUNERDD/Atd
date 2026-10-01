#!/usr/bin/env python3
"""build_kit.py - build a lean Apple-design web kit from assets/css (see references/web.md §1–§2).

Python 3.9+, standard library only. Never Read the kit CSS end to end: build only what you use.

  python3 scripts/build_kit.py --list                         # blocks: requires, layer, size, native analog
  python3 scripts/build_kit.py --markup tabbar sheet          # markup + usage notes of these blocks (read this, not the CSS)
  python3 scripts/build_kit.py base type glass states button  # tokens.css + blocks (deps resolved) -> stdout
  python3 scripts/build_kit.py tabbar list --minify --css kit.css --js kit.js
  python3 scripts/build_kit.py --all --no-layer --css everything.css
  python3 scripts/build_kit.py --size base type glass states button
  python3 scripts/build_kit.py --check                        # lint blocks, tokens, JS and pages; report only, never edits
  python3 scripts/build_kit.py button sheet --minify --inline index.html   # fill <style data-kit> / <script data-kit>

Output order: `@layer apple.base, apple.components;`, then tokens.css (unlayered), then each block wrapped in
the layer its header names (dependency order). --no-layer drops the layer wrappers. --js writes a classic-script
bundle: assets/js/apple-interactions.js with `export` stripped (wrapped in an IIFE) plus assets/js/blocks/<name>.js
for the selected blocks that have one. --minify also minifies that JS: comments, indentation and blank lines go;
strings, template literals and regex literals are copied untouched, and line breaks stay (no ASI changes).
Exit codes: 0 ok; 1 lint errors (--check) or missing blocks (--size); 2 usage error, unknown block or cycle.
"""
import argparse
import gzip
import re
import textwrap
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS_DIR = ROOT / "assets" / "css"
BLOCK_DIR = CSS_DIR / "blocks"
TOKENS = CSS_DIR / "tokens.css"
JS_CORE = ROOT / "assets" / "js" / "apple-interactions.js"
JS_BLOCK_DIR = ROOT / "assets" / "js" / "blocks"
LAYERS = {"base": "apple.base", "components": "apple.components"}
LAYER_STATEMENT = "@layer apple.base, apple.components;"
EMPTY_REQUIRES = {"", "—", "-", "–", "none"}
IMPLICIT_REQUIRES = {"tokens"}  # tokens.css is always emitted
HEADER_RE = re.compile(
    r"^/\* @block (?P<name>[a-z0-9][a-z0-9-]*) \| requires: (?P<requires>[^|]*?) \| layer: (?P<layer>[a-z]+)"
    r" \| native: (?P<native>[^|]*?) \| (?P<purpose>.+?) \*/\s*$"
)
# Internal review labels (review rounds and their findings, fix and phase labels, handoff specs, decision logs) mean
# nothing to people who read the kit through --markup, --help, a built page or a copied file: cite a rule ID, a
# reference section or a public spec instead. Written so that this file doesn't match itself.
INTERNAL_ID_RE = re.compile(
    r"\bR[123](?:-\d+)?\b|\bF-\d\d\b|\bw[1]\b|\bweb[-]kit\b|\broot (?:D|v)\d[\d.]*|\bP[123][A-Z]?-[A-Za-z0-9]+"
    r"|\b(?:motion|feedback)[-]web[-]spec\b|\btriage t\d\b|\bregistry r\d\b")
STARTER = ["base", "type", "glass", "states", "button"]


# --------------------------------------------------------------------------- text helpers

def read_text(path):
    """Read UTF-8 text; None if the file vanished (blocks may appear or change while the script runs)."""
    try:
        return path.read_text(encoding="utf-8", errors="replace").lstrip("﻿")
    except (FileNotFoundError, IsADirectoryError, PermissionError):
        return None


def split_strings_comments(text):
    """Yield (kind, chunk) with kind in {'code', 'string', 'comment'}; strings keep their quotes."""
    i, n, start = 0, len(text), 0
    while i < n:
        c = text[i]
        if c in "\"'":
            if i > start:
                yield "code", text[start:i]
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == "\\" else 1
            j = min(j + 1, n)
            yield "string", text[i:j]
            i = start = j
        elif c == "/" and text.startswith("/*", i):
            if i > start:
                yield "code", text[start:i]
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            yield "comment", text[i:j]
            i = start = j
        else:
            i += 1
    if start < n:
        yield "code", text[start:]


def strip_comments(text):
    """Blank out comments but keep every newline, so positions and line numbers still match the file."""
    return "".join(re.sub(r"[^\n]", " ", chunk) if kind == "comment" else chunk
                   for kind, chunk in split_strings_comments(text))


def comments_of(text):
    return [chunk for kind, chunk in split_strings_comments(text) if kind == "comment"]


def minify_css(text):
    """Conservative minifier: drops comments (keeps /*! … */), collapses whitespace outside strings,
    and removes spaces only where CSS never needs them. Never touches +, -, * (calc and combinators)."""
    strings, parts = [], []
    for kind, chunk in split_strings_comments(text):
        if kind == "comment":
            if chunk.startswith("/*!"):
                strings.append(chunk)
                parts.append("\x00%d\x00" % (len(strings) - 1))
            else:
                parts.append(" ")
        elif kind == "string":
            strings.append(chunk)
            parts.append("\x00%d\x00" % (len(strings) - 1))
        else:
            parts.append(chunk)
    s = re.sub(r"\s+", " ", "".join(parts))
    s = re.sub(r"\s*([{};,>/])\s*", r"\1", s)
    s = re.sub(r":\s+", ":", s)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)
    s = re.sub(r"\s+!important", "!important", s)
    s = re.sub(r";+}", "}", s)
    s = re.sub(r"(?<![\w.#-])0\.(\d)", r".\1", s)   # 0.5 -> .5
    s = s.strip()
    return re.sub(r"\x00(\d+)\x00", lambda m: strings[int(m.group(1))], s)


JS_REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")
JS_REGEX_KEYWORDS = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do",
                     "else", "yield", "await"}


def _js_quoted(src, i):
    """End index (exclusive) of the string literal that opens at src[i]."""
    q, j, n = src[i], i + 1, len(src)
    while j < n and src[j] != q and src[j] != "\n":
        j += 2 if src[j] == "\\" else 1
    return min(j + 1, n)


def _js_template_text(src, i):
    """Scan template-literal text from i (just past ` or past the } that closed a ${…}). Returns (end, opens_expr)."""
    j, n = i, len(src)
    while j < n:
        if src[j] == "\\":
            j += 2
        elif src[j] == "`":
            return j + 1, False
        elif src.startswith("${", j):
            return j + 2, True
        else:
            j += 1
    return n, False


def _js_regex(src, i):
    """End index of the regex literal (flags included) that opens at src[i]."""
    j, n, in_class = i + 1, len(src), False
    while j < n and src[j] != "\n":
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if in_class:
            in_class = c != "]"
        elif c == "[":
            in_class = True
        elif c == "/":
            j += 1
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            return j
        j += 1
    return j


def js_chunks(src):
    """Split JS into (kind, text) chunks. kind: 'code'; 'keep' (string, template-literal text, regex literal or a
    /*! */ banner, copied verbatim); 'block' or 'line' (comments). ${…} expressions inside templates are code."""
    out, n, i, start = [], len(src), 0, 0
    depths, prev = [], ""      # brace depth of each open ${…}; last significant token (punctuator, word or "lit")

    def flush(upto):
        if upto > start:
            out.append(("code", src[start:upto]))

    def template(at, j):       # template text from `at` (a backtick or a closing brace) up to j
        nonlocal i, start, prev
        end, expr = _js_template_text(src, j)
        out.append(("keep", src[at:end]))
        i = start = end
        if expr:
            depths.append(0)
        prev = "(" if expr else "lit"

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c in "'\"":
            flush(i)
            j = _js_quoted(src, i)
            out.append(("keep", src[i:j]))
            i = start = j
            prev = "lit"
        elif c == "`":
            flush(i)
            template(i, i + 1)
        elif c == "/" and nxt == "*":
            flush(i)
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(("keep" if src.startswith("/*!", i) else "block", src[i:j]))
            i = start = j
        elif c == "/" and nxt == "/":
            flush(i)
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(("line", src[i:j]))
            i = start = j
        elif c == "/" and (prev in ("", "}") or prev in JS_REGEX_AFTER or prev in JS_REGEX_KEYWORDS):
            flush(i)
            j = _js_regex(src, i)
            out.append(("keep", src[i:j]))
            i = start = j
            prev = "lit"
        elif depths and c == "}" and depths[-1] == 0:
            depths.pop()
            flush(i)
            template(i, i + 1)
        elif c.isalnum() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            prev = src[i:j]
            i = j
        else:
            if depths and c == "{":
                depths[-1] += 1
            elif depths and c == "}":
                depths[-1] -= 1
            if not c.isspace():
                prev = "lit" if c in "+-" and i > 0 and src[i - 1] == c else c   # a++ / b divides
            i += 1
    flush(n)
    return out


def minify_js(src):
    """Drop comments (keeps /*! … */), indentation, trailing spaces and blank lines; collapse runs of spaces in code.
    Strings, template text and regex literals are untouched and every line break between statements stays, so the
    result parses and runs exactly like the source."""
    parts, buf = [], []

    def flush():
        if buf:
            code = re.sub(r"[ \t]*\n[ \t\n]*", "\n", "".join(buf))
            parts.append(re.sub(r"[ \t]+", " ", code))
            buf.clear()

    for kind, text in js_chunks(src):
        if kind == "code":
            buf.append(text)
        elif kind == "block":
            buf.append("\n" if "\n" in text else " ")   # a comment with a line break still ends the line (ASI)
        elif kind == "keep":
            flush()
            parts.append(text)
    flush()
    return "".join(parts).strip() + "\n"


def gz_len(text):
    return len(gzip.compress(text.encode("utf-8"), 9))


def kb(n):
    return "%.1f KB" % (n / 1000)


# --------------------------------------------------------------------------- blocks

class Block:
    def __init__(self, path):
        self.path = path
        self.stem = path.stem
        self.text = read_text(path)
        self.errors, self.warnings = [], []
        self.name, self.requires, self.layer, self.native, self.purpose = self.stem, [], "components", "", ""
        self.header_ok = False
        if self.text is None:
            self.errors.append((0, "file vanished while reading"))
            self.text = ""
            return
        first = self.text.split("\n", 1)[0]
        m = HEADER_RE.match(first)
        if not m:
            self.errors.append((1, "header must be the first line, exactly: /* @block <name> | requires: <a>, <b> | "
                                   "layer: base|components | native: <analog or —> | <purpose> */"))
            return
        self.header_ok = True
        self.name = m.group("name")
        req = m.group("requires").strip()
        self.requires = [] if req in EMPTY_REQUIRES else [r.strip() for r in req.split(",") if r.strip()]
        self.layer = m.group("layer")
        self.native = m.group("native").strip()
        self.purpose = m.group("purpose").strip()
        if self.layer not in LAYERS:
            self.errors.append((1, "layer must be 'base' or 'components', not %r" % self.layer))
            self.layer = "components"
        if self.name != self.stem:
            self.errors.append((1, "header name %r does not match file name %r" % (self.name, self.path.name)))

    @property
    def body(self):
        return self.text

    def deps(self):
        return [r for r in self.requires if r not in IMPLICIT_REQUIRES and r not in EMPTY_REQUIRES]


def load_blocks():
    blocks = {}
    for path in sorted(BLOCK_DIR.glob("*.css")) if BLOCK_DIR.is_dir() else []:
        b = Block(path)
        key = b.name if b.header_ok else b.stem
        if key in blocks:
            b.errors.append((1, "duplicate block name %r (also %s)" % (key, blocks[key].path.name)))
            key = b.stem + "#dup"
        blocks[key] = b
    return blocks


def resolve(names, blocks):
    """Dependency order (requires first); raises ValueError on unknown blocks or cycles."""
    order, state = [], {}

    def visit(name, chain):
        if name not in blocks:
            via = (" (required by %s)" % chain[-1]) if chain else ""
            raise ValueError("unknown block %r%s" % (name, via))
        if state.get(name) == "done":
            return
        if state.get(name) == "active":
            raise ValueError("dependency cycle: %s" % " -> ".join(chain + [name]))
        state[name] = "active"
        for dep in blocks[name].deps():
            visit(dep, chain + [name])
        state[name] = "done"
        order.append(name)

    for n in names:
        visit(n, [])
    # Emit base-layer blocks first; the relative (dependency) order inside each layer is kept.
    return [n for n in order if blocks[n].layer == "base"] + [n for n in order if blocks[n].layer != "base"]


def assemble(order, blocks, layered=True, minify=False):
    tokens = read_text(TOKENS)
    if tokens is None:
        raise ValueError("missing %s" % TOKENS.relative_to(ROOT))
    out = ["/*! apple-design web kit | scripts/build_kit.py | blocks: %s */" % (", ".join(order) or "(tokens only)")]
    if layered:
        out.append(LAYER_STATEMENT)
    out.append(tokens.strip())
    run_layer, run = None, []

    def flush():
        if run:
            body = "\n\n".join(run)
            out.append("@layer %s {\n%s\n}" % (LAYERS[run_layer], body) if layered else body)

    for name in order:
        b = blocks[name]
        if b.layer != run_layer:
            flush()
            run_layer, run = b.layer, []
        run.append(b.body.strip())
    flush()
    css = "\n\n".join(out) + "\n"
    return minify_css(css) + "\n" if minify else css


def build_js(order, minify=False):
    core = read_text(JS_CORE)
    if core is None:
        raise ValueError("missing %s" % JS_CORE.relative_to(ROOT))
    core = re.sub(r"^export\s+(?=(?:const|let|var|function|class|async)\b)", "", core, flags=re.M)
    core = re.sub(r"^export\s*\{[^}]*\};?\s*$", "", core, flags=re.M)
    parts = ["/*! apple-design web kit JS (classic script) | scripts/build_kit.py | blocks: %s */" % (", ".join(order) or "(core only)"),
             "(() => {\n" + core.strip() + "\n})();"]
    for name in order:
        p = JS_BLOCK_DIR / ("%s.js" % name)
        js = read_text(p) if p.is_file() else None
        if js:
            parts.append("/* block: %s */\n%s" % (name, js.strip()))
    js = "\n\n".join(parts) + "\n"
    return minify_js(js) if minify else js


# --------------------------------------------------------------------------- CSS mini parser (for --check)

class Node:
    __slots__ = ("kind", "prelude", "line", "decls", "children", "parent")

    def __init__(self, kind, prelude, line, parent=None):
        self.kind, self.prelude, self.line, self.parent = kind, prelude, line, parent
        self.decls, self.children = [], []


def parse_css(code):
    """code = comment-stripped CSS (positions preserved). Returns a root Node; tolerant of nesting."""
    root = Node("root", "", 1)
    stack, start, depth, i, n = [root], 0, 0, 0, len(code)
    line_at = lambda pos: code.count("\n", 0, pos) + 1  # noqa: E731

    def first_char(a, b):
        seg = code[a:b]
        return a + (len(seg) - len(seg.lstrip()))

    def add_item(a, b):
        item = code[a:b].strip()
        if not item:
            return
        pos = first_char(a, b)
        if item.startswith("@"):
            stack[-1].children.append(Node("at-statement", item, line_at(pos), stack[-1]))
        elif ":" in item:
            prop, val = item.split(":", 1)
            stack[-1].decls.append((prop.strip(), val.strip(), line_at(pos)))

    while i < n:
        c = code[i]
        if c in "\"'":
            j = i + 1
            while j < n and code[j] != c:
                j += 2 if code[j] == "\\" else 1
            i = j + 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and c == "{":
            prelude = code[start:i].strip()
            node = Node("at" if prelude.startswith("@") else "rule", prelude, line_at(first_char(start, i)), stack[-1])
            stack[-1].children.append(node)
            stack.append(node)
            start = i + 1
        elif depth == 0 and c == ";":
            add_item(start, i)
            start = i + 1
        elif depth == 0 and c == "}":
            add_item(start, i)
            if len(stack) > 1:
                stack.pop()
            start = i + 1
        i += 1
    return root


def walk(node):
    for ch in node.children:
        yield ch
        yield from walk(ch)


def split_top(sel, sep=","):
    parts, depth, cur = [], 0, []
    for ch in sel:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def full_selectors(node):
    """Expand nesting (&) against the nearest ancestor rule; returns the list of selectors."""
    own = split_top(node.prelude)
    parent = node.parent
    while parent is not None and parent.kind != "rule":
        parent = parent.parent
    if parent is None:
        return own
    outer = full_selectors(parent)
    out = []
    for s in own:
        for o in outer:
            out.append(s.replace("&", ":is(%s)" % o) if "&" in s else "%s %s" % (o, s))
    return out


def subject(selector):
    """Last compound selector (after the last top-level combinator)."""
    depth, last = 0, 0
    for i, ch in enumerate(selector):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif depth == 0 and ch in " >+~":
            last = i + 1
    return selector[last:].strip()


def media_chain(node):
    out, p = [], node.parent
    while p is not None:
        if p.kind == "at":
            out.append(p.prelude)
        p = p.parent
    return out


VAR_RE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
DECL_NAME_RE = re.compile(r"(?<![\w-])(--[A-Za-z0-9_-]+)\s*:")
PROPERTY_RE = re.compile(r"@property\s+(--[A-Za-z0-9_-]+)")
HOVER_OK_RE = re.compile(r"hover\s*:\s*hover", re.I)
FINE_OK_RE = re.compile(r"pointer\s*:\s*fine", re.I)
ROOTISH_RE = re.compile(r":root\b|(?<![\w.#:-])html\b")


def declared_names(code):
    return set(DECL_NAME_RE.findall(code)) | set(PROPERTY_RE.findall(code))


def token_inventory():
    text = read_text(TOKENS)
    if text is None:
        return None, set(), set()
    code = strip_comments(text)
    hooks = set()
    for c in comments_of(text):
        if c.lstrip("/* ").startswith("@hooks"):
            hooks |= set(re.findall(r"--[A-Za-z0-9_-]+", c))
    return text, declared_names(code), hooks


def line_of(code, pos):
    return code.count("\n", 0, pos) + 1


def lint_tokens(text, defined, hooks):
    errors, warnings = [], []
    code = strip_comments(text)
    if not hooks:
        errors.append((0, "no /* @hooks … */ comment listing author hooks"))
    for m in VAR_RE.finditer(code):
        if m.group(1) not in defined and m.group(1) not in hooks:
            errors.append((line_of(code, m.start()), "var(%s) is not defined in tokens.css" % m.group(1)))
    allowed = re.compile(r"^(:root|\[data-(theme|tint)[^\]]*\]|:where\(.*\)|:not\(.*\)|\s|,)+$")
    for node in walk(parse_css(code)):
        if node.kind == "rule":
            for sel in split_top(node.prelude):
                if not allowed.match(sel):
                    warnings.append((node.line, "tokens.css scope %r is not :root, [data-theme] or [data-tint]" % sel))
            for prop, _, line in node.decls:
                if not prop.startswith("--") and prop != "color-scheme":
                    warnings.append((line, "tokens.css should hold custom properties and color-scheme only (%s)" % prop))
    return errors, warnings


def lint_block(b, blocks, defined, hooks):
    if not b.header_ok and not b.text:
        return
    code = strip_comments(b.text)
    if "@endblock" in b.text:
        b.errors.append((line_of(b.text, b.text.find("@endblock")), "remove @endblock markers (one block per file)"))
    for m in re.finditer(r"@layer\b", code):
        b.errors.append((line_of(code, m.start()), "no @layer inside a block (the build adds layers)"))
    for dep in b.deps():
        if dep not in blocks:
            b.errors.append((1, "requires unknown block %r" % dep))
    if b.header_ok and not b.native:
        b.warnings.append((1, "native analog is empty (use — when there is none)"))
    own = declared_names(code)
    seen = set()
    for m in VAR_RE.finditer(code):
        name = m.group(1)
        if name in defined or name in hooks or name in own or name in seen:
            continue
        seen.add(name)
        others = [o for o, ob in blocks.items() if o != b.name and name in declared_names(strip_comments(ob.text))]
        hint = (" (declared only in block %s)" % ", ".join(others)) if others else ""
        b.errors.append((line_of(code, m.start()),
                         "var(%s) is not defined in tokens.css, declared in this block, or listed in @hooks%s" % (name, hint)))
    tree = parse_css(code)
    for node in walk(tree):
        if node.kind != "rule":
            continue
        sels = full_selectors(node)
        if any(p.startswith("--") for p, _, _ in node.decls):
            for s in sels:
                if ROOTISH_RE.search(subject(s)):
                    b.errors.append((node.line, "blocks must not define custom properties on :root (%s)" % s.strip()))
                    break
        if ":hover" in node.prelude or any(":hover" in s for s in sels):
            chain = media_chain(node)
            if not any(HOVER_OK_RE.search(p) and FINE_OK_RE.search(p) for p in chain if p.startswith("@media")):
                b.errors.append((node.line, "hover rule not gated by @media (hover: hover) and (pointer: fine): %s"
                                 % node.prelude[:80]))


def lint_internal_ids():
    """Every agent- or user-visible kit text: tokens, blocks, JS, scripts (their --help) and the built pages."""
    paths = [TOKENS] + sorted(BLOCK_DIR.glob("*.css")) + [JS_CORE] + sorted(JS_BLOCK_DIR.glob("*.js")) \
        + sorted((ROOT / "scripts").glob("*.py")) + sorted((ROOT / "assets").glob("*.html"))
    results = []
    for p in paths:
        text = read_text(p) if p.is_file() else None
        if text is None:
            continue
        errors = [(line_of(text, m.start()), "internal review label %r: use a rule ID, a reference section "
                   "(web.md §2), a public spec or plain words" % m.group(0))
                  for m in INTERNAL_ID_RE.finditer(text)]
        results.append((p, errors))
    return results


def lint_js_blocks(blocks):
    results = []
    if not JS_BLOCK_DIR.is_dir():
        return results
    for p in sorted(JS_BLOCK_DIR.glob("*.js")):
        errors, warnings = [], []
        js = read_text(p)
        if js is None:
            errors.append((0, "file vanished while reading"))
        else:
            for m in re.finditer(r"^\s*(import|export)\b", js, flags=re.M):
                errors.append((line_of(js, m.start()), "block JS must be a classic script (no %s)" % m.group(1)))
            if p.stem not in blocks:
                warnings.append((0, "no CSS block named %r" % p.stem))
            if "AppleBlocks" not in js:
                warnings.append((0, "should attach globalThis.AppleBlocks.%s = { init(root = document) }" % p.stem))
        results.append((p, errors, warnings))
    return results


# --------------------------------------------------------------------------- commands

def cmd_list(blocks):
    tokens = read_text(TOKENS) or ""
    rows = [("tokens.css", "(always)", "—", len(tokens.encode()), len(minify_css(tokens).encode()), "—",
             "Core custom properties (color, type, space, radii, motion, state, glass)")]
    for name, b in blocks.items():
        rows.append((name if b.header_ok else name + " (!)", ", ".join(b.requires) or "—", b.layer if b.header_ok else "?",
                     len(b.text.encode()), len(minify_css(b.text).encode()), b.native or "?", b.purpose or "(bad header)"))
    w = [max(len(str(r[i])) for r in rows + [("block", "requires", "layer", "raw", "min", "native", "")]) for i in range(5)]
    print("%-*s  %-*s  %-*s  %*s  %*s  %s" % (w[0], "block", w[1], "requires", w[2], "layer", w[3], "raw", w[4], "min",
                                                 "native analog | purpose"))
    for r in rows:
        print("%-*s  %-*s  %-*s  %*d  %*d  %s | %s" % (w[0], r[0], w[1], r[1], w[2], r[2], w[3], r[3], w[4], r[4], r[5], r[6]))
    bad = [n for n, b in blocks.items() if not b.header_ok]
    if bad:
        print("\n(!) bad or missing header: %s — run --check" % ", ".join(bad))
    return 0


def cmd_size(names, blocks, layered):
    missing = [n for n in names if n not in blocks]
    known = [n for n in names if n in blocks]
    try:
        order = resolve(known, blocks)
    except ValueError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2
    tokens = read_text(TOKENS) or ""
    print("%-16s %9s %9s" % ("part", "raw", "min"))
    print("%-16s %9d %9d" % ("tokens.css", len(tokens.encode()), len(minify_css(tokens).encode())))
    for n in order:
        t = blocks[n].text
        print("%-16s %9d %9d" % (n, len(t.encode()), len(minify_css(t).encode())))
    raw = assemble(order, blocks, layered=layered)
    mini = assemble(order, blocks, layered=layered, minify=True)
    print("-" * 36)
    print("built (%s): raw %s · min %s · gzip(min) %s · gzip(raw) %s" % (
        "layered" if layered else "no layers", kb(len(raw.encode())), kb(len(mini.encode())), kb(gz_len(mini)), kb(gz_len(raw))))
    print("blocks: %s" % ", ".join(order))
    print("budget (WEB-1): starter %s <= ~6 KB gzip (~23 KB min) · typical iOS app shell <= ~10 KB gzip (~42 KB min) · never --all in a deliverable" % ", ".join(STARTER))
    if missing:
        print("missing (not in assets/css/blocks yet): %s" % ", ".join(missing))
        return 1
    return 0


def cmd_check(blocks):
    text, defined, hooks = token_inventory()
    n_err = n_warn = 0

    def report(label, errors, warnings):
        nonlocal n_err, n_warn
        n_err += len(errors)
        n_warn += len(warnings)
        status = "OK" if not errors and not warnings else "%d error(s), %d warning(s)" % (len(errors), len(warnings))
        print("%-34s %s" % (label, status))
        for line, msg in errors:
            print("    E%s %s" % ((" line %d:" % line) if line else ":", msg))
        for line, msg in warnings:
            print("    W%s %s" % ((" line %d:" % line) if line else ":", msg))

    print("build_kit.py --check  (%d block file(s) in %s)" % (len(blocks), BLOCK_DIR.relative_to(ROOT)))
    if text is None:
        report("tokens.css", [(0, "missing %s" % TOKENS.relative_to(ROOT))], [])
    else:
        e, w = lint_tokens(text, defined, hooks)
        report("tokens.css (%d names, %d hooks)" % (len(defined), len(hooks)), e, w)
    for name, b in blocks.items():
        lint_block(b, blocks, defined, hooks)
    # cycles (report each block once)
    for name in blocks:
        try:
            resolve([name], blocks)
        except ValueError as e:
            if "cycle" in str(e):
                blocks[name].errors.append((1, str(e)))
    for name, b in blocks.items():
        report(b.path.name, b.errors, b.warnings)
    for p, e, w in lint_js_blocks(blocks):
        report("js/blocks/%s" % p.name, e, w)
    scanned = lint_internal_ids()
    dirty = [(p, e) for p, e in scanned if e]
    if not dirty:
        report("no internal review labels (%d files)" % len(scanned), [], [])
    for p, e in dirty:
        report("labels in %s" % p.relative_to(ROOT), e, [])
    print("summary: %d error(s), %d warning(s)" % (n_err, n_warn))
    return 1 if n_err else 0


KIT_STYLE_RE = re.compile(r"(<style\b[^>]*\bdata-kit\b[^>]*>)(.*?)(</style\s*>)", re.S | re.I)
KIT_SCRIPT_RE = re.compile(r"(<script\b[^>]*\bdata-kit\b[^>]*>)(.*?)(</script\s*>)", re.S | re.I)


def inline_into(html_path, css, order, minify=False):
    """Replace the contents of <style data-kit> (required) and <script data-kit> (optional) in html_path.
    Idempotent: re-running swaps in a fresh build, so the kit never has to pass through an editor or a prompt."""
    path = Path(html_path)
    html = read_text(path)
    if html is None:
        raise ValueError("--inline: %s not found" % html_path)
    if not KIT_STYLE_RE.search(html):
        raise ValueError("--inline: no <style data-kit></style> in %s; add it in <head> (and <script data-kit></script> "
                         "before </body> if you want the JS)" % html_path)
    html = KIT_STYLE_RE.sub(lambda m: m.group(1) + "\n" + css.strip() + "\n" + m.group(3), html, count=1)
    js = None
    if KIT_SCRIPT_RE.search(html):
        js = build_js(order, minify).replace("</script", "<\\/script")
        html = KIT_SCRIPT_RE.sub(lambda m: m.group(1) + "\n" + js.strip() + "\n" + m.group(3), html, count=1)
    path.write_text(html, encoding="utf-8")
    print("inlined into %s: CSS %s%s (blocks: %s); page now %s" % (
        html_path, kb(len(css.encode())), (", JS %s" % kb(len(js.encode()))) if js else ", no <script data-kit>",
        ", ".join(order), kb(len(html.encode()))), file=sys.stderr)


def cmd_markup(names, blocks):
    """Print each named block's usage comment (the first comment after its header): markup, states, rules."""
    unknown = [n for n in names if n not in blocks]
    if unknown:
        print("error: unknown block(s): %s (see --list)" % ", ".join(unknown), file=sys.stderr)
        return 2
    for n in names:
        body = blocks[n].text.split("\n", 1)[1] if "\n" in blocks[n].text else ""
        m = re.match(r"\s*/\*(.*?)\*/", body, re.S)
        print("== %s  (requires: %s)" % (n, ", ".join(blocks[n].deps()) or "—"))
        print(textwrap.dedent(m.group(1)).strip("\n") if m else "(no usage comment)")
        print()
    return 0


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    ap.add_argument("blocks", nargs="*", help="block names (see --list); dependencies are added automatically")
    ap.add_argument("--list", action="store_true", help="table of blocks: requires, layer, bytes raw/min, native analog, purpose")
    ap.add_argument("--all", action="store_true", help="every block in assets/css/blocks")
    ap.add_argument("--css", metavar="FILE", help="write CSS here (default: stdout)")
    ap.add_argument("--js", metavar="FILE", help="also write a classic-script JS bundle for the selected blocks")
    ap.add_argument("--minify", action="store_true", help="strip comments and whitespace from the CSS and the JS")
    ap.add_argument("--no-layer", action="store_true", help="no @layer wrappers (plain cascade)")
    ap.add_argument("--check", action="store_true", help="lint tokens.css, the blocks and block JS, and internal review labels in the "
                    "kit, scripts and pages (report only)")
    ap.add_argument("--size", action="store_true", help="raw / min / gzip report for the given block set")
    ap.add_argument("--markup", action="store_true", help="print the usage comment (markup, states, notes) of the named blocks")
    ap.add_argument("--inline", metavar="HTML", help="write the build into <style data-kit> and <script data-kit> of HTML "
                    "(replaces their contents; safe to re-run)")
    args = ap.parse_args(argv)

    blocks = load_blocks()
    if args.list:
        return cmd_list(blocks)
    if args.check:
        return cmd_check(blocks)
    names = list(blocks) if args.all else args.blocks
    if args.markup:
        return cmd_markup(names, blocks)
    if args.size:
        return cmd_size(names or STARTER, blocks, not args.no_layer)
    if not names and not (args.js or args.inline):
        ap.print_usage(sys.stderr)
        print("error: name blocks to build (or --all / --list / --check / --size)", file=sys.stderr)
        return 2
    try:
        order = resolve(names, blocks)
        broken = [n for n in order if not blocks[n].header_ok]
        if broken:
            raise ValueError("block(s) with a bad header: %s (run --check)" % ", ".join(broken))
        css = assemble(order, blocks, layered=not args.no_layer, minify=args.minify)
        js = build_js(order, args.minify) if args.js else None
    except ValueError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2
    if args.inline:
        try:
            inline_into(args.inline, css, order, args.minify)
        except ValueError as e:
            print("error: %s" % e, file=sys.stderr)
            return 2
    if args.css:
        Path(args.css).write_text(css, encoding="utf-8")
        print("wrote %s (%s, blocks: %s)" % (args.css, kb(len(css.encode())), ", ".join(order)), file=sys.stderr)
    elif not args.inline:
        sys.stdout.write(css)
    if js is not None:
        Path(args.js).write_text(js, encoding="utf-8")
        print("wrote %s (%s)" % (args.js, kb(len(js.encode()))), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
