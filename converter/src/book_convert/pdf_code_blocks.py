"""Restore fenced code blocks that the layout engine flattens into prose.

pymupdf4llm joins monospaced listings into one wrapped line and only fences code when
the font carries the monospace flag (many book PDFs don't set it). We find monospaced
blocks ourselves from the page's span fonts and re-insert them, with their line breaks,
wherever their whitespace-insensitive text appears in the page Markdown.
"""

from __future__ import annotations

import re

import pymupdf

_MONO_FONT = re.compile(r"mono|courier|consol|menlo|typewriter|code|inconsolata|\bmn\b|mn-|mn$", re.I)
MAX_TOKENS = 600  # regex size guard for very long listings


def _is_mono(span: dict) -> bool:
    return bool(span["flags"] & 8) or bool(_MONO_FONT.search(span["font"]))


def monospaced_blocks(page: pymupdf.Page) -> list[list[str]]:
    """Each result is the lines of one run of consecutive all-monospaced blocks."""
    runs: list[list[str]] = []
    current: list[str] = []
    for block in page.get_text("dict")["blocks"]:
        lines = []
        mono = block["type"] == 0
        if mono:
            for line in block["lines"]:
                spans = [s for s in line["spans"] if s["text"].strip()]
                if any(not _is_mono(s) for s in spans):
                    mono = False
                    break
                lines.append("".join(s["text"] for s in line["spans"]).rstrip())
        if mono and any(lines):
            current.extend(lines)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return runs


def _token_pattern(code: str) -> re.Pattern | None:
    tokens = code.split()
    if not tokens or len(tokens) > MAX_TOKENS:
        return None
    # Markdown may escape punctuation ("\_", "\*"), so allow an optional backslash before it.
    def esc(tok: str) -> str:
        return "".join(re.escape(c) if c.isalnum() else r"\\?" + re.escape(c) for c in tok)
    # The engine may already have turned lines into bullets or inline `code` spans, so
    # tolerate backticks and list markers around and between tokens.
    sep = r"[\s`]+(?:[-*]\s+)?`?"
    return re.compile(r"(?:[-*]\s+)?`?" + sep.join(esc(t) for t in tokens) + r"`?")


_EXISTING_FENCE = re.compile(r"(^```.*?^```[ \t]*$)", re.S | re.M)


def fence_code(page_md: str, blocks: list[list[str]]) -> str:
    """Replace the flattened text of each monospaced block with a fenced block.

    Fences the engine already produced are never touched.
    """
    for lines in blocks:
        code = "\n".join(lines).strip("\n")
        if len(code.split()) < 2:  # single words are inline code, not listings
            continue
        pattern = _token_pattern(code)
        if pattern is None:
            continue
        parts = _EXISTING_FENCE.split(page_md)  # odd indices are existing fenced blocks
        for i in range(0, len(parts), 2):
            parts[i], n = pattern.subn(lambda _m, c=code: f"\n\n```\n{c}\n```\n\n", parts[i], count=1)
            if n:
                break
        page_md = "".join(parts)
    return page_md
