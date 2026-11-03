"""Chapter-level Markdown normalization for PDF output.

PDF text has no paragraphs, only lines on fixed pages, so the extractor (and our page joins)
break structure in predictable ways. Three generic repairs, applied per chapter after pages
are joined:

1. Fake headings: a short continuation line at the top of a page ("want of a wife.") gets a
   heading marker. Real headings never start lowercase, so those are demoted to text.
2. Split paragraphs: a paragraph that stops mid-sentence ("…must be in") followed by one
   that starts lowercase ("want of a wife.") is one paragraph cut by a page break or block gap.
3. Footnote markers: `<sup>34</sup>` becomes `³⁴` so previews, skills and MCP clients read
   plain text instead of raw HTML.
4. Labelled rules: decorative "------ CHAPTER 9 ------" lines become "—— CHAPTER 9 ——".
5. Emphasis debris: adjacent bold runs ("**Body** **:**"), empty markers ("****") and bold
   punctuation are merged or dropped; quote attributions ("- Sun Tzu") promoted to
   headings by their larger font become emphasized lines.
"""

from __future__ import annotations

import re

_FENCE = re.compile(r"^\s*(```|~~~)")
_LOWER_HEADING = re.compile(r"^#{1,6}[ \t]+(?=[a-z])")
# A block that ends mid-sentence: last char is a letter, digit, comma, semicolon, dash or superscript.
_OPEN_END = re.compile(r"[A-Za-z0-9,;—–¹²³⁰-⁹]\**$")
# The next block continues it: starts with a lowercase letter (optionally after emphasis markers).
_CONTINUES = re.compile(r"^[*_]*[a-z]")
_NOT_PROSE = ("#", "|", ">", "```", "~~~", "<", "![", "---", "***")
_SUPERSCRIPT_DIGITS = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def demote_lowercase_headings(md: str) -> str:
    """'#### want of a wife.' -> 'want of a wife.' (outside code fences)."""
    out, in_code = [], False
    for line in md.split("\n"):
        if _FENCE.match(line):
            in_code = not in_code
        elif not in_code:
            line = _LOWER_HEADING.sub("", line)
        out.append(line)
    return "\n".join(out)


def _blocks(md: str) -> list[str]:
    """Split on blank lines, keeping fenced code blocks whole."""
    blocks, cur, in_code = [], [], False
    for line in md.split("\n"):
        if _FENCE.match(line):
            in_code = not in_code
        if not line.strip() and not in_code:
            if cur:
                blocks.append("\n".join(cur))
                cur = []
            continue
        cur.append(line)
    if cur:
        blocks.append("\n".join(cur))
    return blocks


def merge_broken_paragraphs(md: str) -> str:
    """Join a block that ends mid-sentence with a following block that starts lowercase."""
    merged: list[str] = []
    for block in _blocks(md):
        head = block.lstrip()
        if merged:
            prev_last = merged[-1].rstrip().split("\n")[-1]
            prev_ok = not prev_last.lstrip().startswith(_NOT_PROSE) and _OPEN_END.search(prev_last)
            if prev_ok and _CONTINUES.match(head) and not head.startswith(_NOT_PROSE):
                merged[-1] = merged[-1].rstrip() + " " + head
                continue
        merged.append(block)
    return "\n\n".join(merged)


def superscript_footnotes(md: str) -> str:
    """'<sup>34</sup>' (also '<sup>**34**</sup>') -> '³⁴'; other <sup>/<sub>/<u> wrappers are unwrapped."""
    md = re.sub(r"\s*<sup>\s*[*_]*\s*(\d{1,3})\s*[*_]*\s*</sup>", lambda m: m.group(1).translate(_SUPERSCRIPT_DIGITS), md)
    return re.sub(r"</?(?:sup|sub|u)>", "", md)


# "### - Sun Tzu": one dash then a name. A run of dashes is a divider, not an attribution.
_ATTRIBUTION_HEADING = re.compile(r"^#{1,6}[ \t]+[-\u2013\u2014][ \t]*(?=[A-Za-z])(.+)$", re.M)
# "**-------------** CHAPTER 9 **-------------**" (or as a heading): a rule with a label in the middle.
_LABELLED_RULE = re.compile(r"^[-\u2013\u2014_=]{3,}[ \t]*([A-Za-z0-9][^-\u2013\u2014_=]{0,40}?)[ \t]*[-\u2013\u2014_=]{3,}$")
LABELLED_RULE_FORMAT = "\u2014\u2014 {} \u2014\u2014"  # canonical "—— CHAPTER 9 ——"; the UI renders it as a centred divider


def _labelled_rule(line: str) -> str | None:
    bare = re.sub(r"^#{1,6}[ \t]+", "", line).replace("**", "").replace("__", "").strip().strip("*_").strip()
    m = _LABELLED_RULE.match(bare)
    return LABELLED_RULE_FORMAT.format(m.group(1).strip()) if m else None


def tidy_emphasis(md: str) -> str:
    """Merge split bold runs, drop empty/punctuation-only emphasis, turn attribution 'headings' into text."""
    out, in_code = [], False
    for line in md.split("\n"):
        if _FENCE.match(line):
            in_code = not in_code
        if not in_code and (divider := _labelled_rule(line)):
            line = divider
        elif not in_code:
            line = _ATTRIBUTION_HEADING.sub(lambda m: "*\u2014 " + m.group(1).replace("**", "").strip() + "*", line)
            line = re.sub(r"\*{4,}", "", line)                                   # empty bold: "****"
            # bold punctuation after a bold word joins it: "**Body** **_:_**" -> "**Body:**"
            line = re.sub(r"\*\*([^*\n]+?)\*\*[ \t]*\*\*_?([:;,.!?])_?\*\*", r"**\1\2**", line)
            line = re.sub(r"\*\*_?([:;,.!?])_?\*\*", r"\1", line)                # stray bold punctuation
            line = re.sub(r"(?<![\w*])_([:;])_(?![\w*])", r"\1", line)             # italic colon "_:_"
            # loose label colon after a bold word: "**Subject** : x" -> "**Subject:** x"
            line = re.sub(r"\*\*([^*\n]+?)\*\*[ \t]+([:;])(?=\s|$)", r"**\1\2**", line)
            line = re.sub(r"\*\*([ \t]+)\*\*", r"\1", line)                     # "**a** **b**" -> "**a b**"
        out.append(line)
    return "\n".join(out)


def normalize_chapter(md: str) -> str:
    """Apply all repairs in order: headings first, so demoted lines can then be merged."""
    return merge_broken_paragraphs(tidy_emphasis(superscript_footnotes(demote_lowercase_headings(md))))
