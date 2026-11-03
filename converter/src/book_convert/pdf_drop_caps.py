"""Repair drop caps and split initial letters in PDF text.

Many ebooks-turned-PDF (calibre, InDesign) start each chapter with a *drop cap*: the first
letter is a separate, oversized glyph in its own text block, and the paragraph sits indented
beside it. Extraction then loses the letter from the first word ("t is a truth" for "It is a truth")
and drops it somewhere else as a stray "**W**" (or a heading/line of its own).

A related style bolds the first letter of each item in an acronym list ("**M**arket,
**O**cean…"), which extraction splits into "**M** arket".

Both are repaired with page geometry plus a whole-book word count, so "A lady’s…" stays
two words while "I" + "t" becomes "It".
"""

from __future__ import annotations

import re
import statistics
from collections import Counter

import pymupdf

# A drop cap is a single glyph at least this many times the page's median body size.
DROP_CAP_RATIO = 2.5
# Letters that are words on their own in English ("A lady’s", "I think").
_STANDALONE_LETTERS = {"A", "I", "O"}
_WORD = re.compile(r"[A-Za-z][A-Za-z’']*")


def book_vocabulary(doc: pymupdf.Document) -> Counter[str]:
    """Lower-cased word counts over the raw text of the whole document."""
    counts: Counter[str] = Counter()
    for page in doc:
        counts.update(w.lower() for w in _WORD.findall(page.get_text()))
    return counts


def find_drop_caps(page: pymupdf.Page) -> list[tuple[str, str]]:
    """Return (letter, text of the line beside it) for every drop cap on the page."""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            spans = [s for s in line["spans"] if s["text"].strip()]
            if spans:
                lines.append((line["bbox"], spans))
    sizes = [s["size"] for _, spans in lines for s in spans]
    if not sizes:
        return []
    body = statistics.median(sizes)
    caps = []
    for bbox, spans in lines:
        text = "".join(s["text"] for s in spans).strip()
        # A narrow cap ("I") can share a line with the paragraph's first line: cap span, then text spans.
        lead = spans[0]["text"].strip()
        if (len(spans) > 1 and len(lead) == 1 and lead.isalpha() and lead.isupper()
                and spans[0]["size"] >= DROP_CAP_RATIO * body
                and max(s["size"] for s in spans[1:]) < DROP_CAP_RATIO * body):
            fragment = "".join(s["text"] for s in spans[1:]).strip()
            if fragment:
                caps.append((lead, fragment))
            continue
        if len(text) != 1 or not text.isalpha() or not text.isupper():
            continue
        if max(s["size"] for s in spans) < DROP_CAP_RATIO * body:
            continue
        x0, y0, x1, y1 = bbox
        # The paragraph's first line starts just right of the cap, within the cap's height.
        beside = [
            (b, sp) for b, sp in lines
            if b[0] >= x1 - 2 and b[0] <= x1 + 4 * body and y0 - body <= b[1] < y1
            and max(s["size"] for s in sp) < DROP_CAP_RATIO * body
        ]
        if not beside:
            continue
        _, first_spans = min(beside, key=lambda item: item[0][1])
        fragment = "".join(s["text"] for s in first_spans).strip()
        if fragment:
            caps.append((text, fragment))
    return caps


def should_join(letter: str, word: str, vocab: Counter[str]) -> bool:
    """Is `letter` the start of `word` (T + he -> The) rather than a word of its own (A + lady’s)?"""
    joined, alone = (letter + word).lower(), word.lower()
    if vocab.get(joined, 0) > 0:
        return True
    if letter.upper() not in _STANDALONE_LETTERS:
        return True
    # "A" / "I" / "O": keep separate only when the rest is a real word elsewhere in the book.
    # A one-letter remainder ("I" + "t", "I" + "n") is never a word of its own, so always join.
    letters = re.sub(r"[^a-z]", "", alone)
    return len(letters) < 2 or vocab.get(alone, 0) <= 1


def _remove_stray(md: str, letter: str) -> str:
    """Drop stray copies of the cap letter. The extractor may emit it twice: once as a '# A' heading
    or lone line, and once inline as '**A**'; remove the first of each form."""
    bold = re.search(rf"(?P<pre>[ \t]?)\*\*{letter}\*\*(?P<post>[ \t]?)", md)
    if bold:
        sep = " " if bold["pre"] and bold["post"] else ""
        md = md[: bold.start()] + sep + md[bold.end():]
    for pattern in (rf"^[ \t]*#{{1,6}}[ \t]+{letter}[ \t]*\n+", rf"^[ \t]*{letter}[ \t]*\n+"):
        md, n = re.subn(pattern, "", md, count=1, flags=re.M)
        if n:
            break
    return md


# The stray copy lands near its paragraph; only look this far before/after the paragraph start,
# so a legitimate bold single letter elsewhere on the page is never touched.
_STRAY_WINDOW = (300, 900)


def repair_drop_caps(md: str, caps: list[tuple[str, str]], vocab: Counter[str]) -> str:
    """Put each drop-cap letter back on its paragraph's first word and remove the stray copy."""
    for letter, fragment in caps:
        words = fragment.split()[:4]
        if not words:
            continue
        # Locate the paragraph start by its first words, tolerant of whitespace and emphasis markers.
        # The lookbehind stops "he Art of War…" from matching inside a heading "The Art of War…".
        pattern = re.compile(r"(?<![\w’'])" + r"[\s*_]*".join(re.escape(w) for w in words))
        first = _WORD.match(words[0])
        join = should_join(letter, first.group(0) if first else words[0], vocab)
        # Cap already right before its paragraph ("I t is a truth"): close or keep the gap, nothing else.
        inline = re.compile(r"(?<![\w’'])(?:\*\*)?" + re.escape(letter) + r"(?:\*\*)?[ \t]+(?=" + pattern.pattern + ")")
        if (hit := inline.search(md)) is not None:
            md = md[: hit.start()] + letter + ("" if join else " ") + md[hit.end():]
            continue
        match = pattern.search(md)
        if not match:
            continue
        lo, hi = max(0, match.start() - _STRAY_WINDOW[0]), min(len(md), match.start() + _STRAY_WINDOW[1])
        md = md[:lo] + _remove_stray(md[lo:hi], letter) + md[hi:]
        match = pattern.search(md)
        if not match:
            continue
        md = md[: match.start()] + letter + ("" if join else " ") + md[match.start():]
    return md


_SPLIT_INITIAL = re.compile(r"\*\*([A-Z])\*\* ([a-z][A-Za-z’'-]*)")


def join_split_initials(md: str, vocab: Counter[str]) -> str:
    """'**M** arket' -> '**M**arket' when 'market' is a word in this book and 'arket' is not."""

    def fix(m: re.Match[str]) -> str:
        letter, rest = m.group(1), m.group(2)
        core = _WORD.match(rest)
        rest_word = core.group(0) if core else rest
        if vocab.get((letter + rest_word).lower(), 0) > 0 and vocab.get(rest_word.lower(), 0) <= 2:
            return f"**{letter}**{rest}"
        return m.group(0)

    return _SPLIT_INITIAL.sub(fix, md)


_COMPOUND = re.compile(r"\b([A-Za-z]{2,})-[ \t]*(\n?)[ \t]*([A-Za-z]{2,})\b")


def compound_hyphens(doc: pymupdf.Document, vocab: Counter[str]) -> dict[str, int]:
    """Map joined spellings ('wellknown') to the hyphen position for compounds the book writes
    with a hyphen. A line-break hyphen counts only when the hyphenated form also appears mid-line,
    or both halves are standalone words ('long-term'), so true hyphenation ('exam-ple') is skipped."""
    text = "\n".join(page.get_text() for page in doc)
    mid_line: Counter[str] = Counter()
    found: dict[str, int] = {}
    for m in _COMPOUND.finditer(text):
        a, newline, b = m.groups()
        key = (a + b).lower()
        if not newline:
            mid_line[key] += 1
        found.setdefault(key, len(a))
    # vocab counts the joined spelling only where the book really prints it ("another", "Wellknown").
    # Restore only when the hyphenated spelling wins; never turn a real word like "another" into "an-other".
    return {
        key: split for key, split in found.items()
        if (mid_line[key] and mid_line[key] > vocab.get(key, 0))
        or (not mid_line[key] and vocab.get(key, 0) == 0
            and vocab.get(key[:split], 0) >= 2 and vocab.get(key[split:], 0) >= 2)
    }


def restore_compound_hyphens(md: str, compounds: dict[str, int]) -> str:
    """'WellKnown' / 'timeto-value' -> 'Well-Known' / 'time-to-value' for known compounds."""
    if not compounds:
        return md

    def fix(m: re.Match[str]) -> str:
        word = m.group(0)
        split = compounds.get(word.lower())
        return word if split is None else word[:split] + "-" + word[split:]

    return re.sub(r"(?<![\w/.:-])[A-Za-z]{4,}(?![\w/])", fix, md)
