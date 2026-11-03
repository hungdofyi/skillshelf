"""Text helpers shared by the PDF and EPUB extractors."""

from __future__ import annotations

import re
import unicodedata

FRONT_MATTER_MIN_WORDS = 150
_LIGATURES = str.maketrans({"œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss", "ø": "o", "Ø": "O"})
_FENCE = re.compile(r"^\s*(```|~~~)")


def count_words(text: str) -> int:
    return len(text.split())


def slugify(text: str, max_len: int = 50) -> str:
    text = text.translate(_LIGATURES)
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    slug = slug[:max_len].strip("-")
    return slug or "chapter"


def normalize_title(text: str) -> str:
    """Comparison key: lowercase alphanumerics only."""
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKD", text).lower())


def clean_title(text: str) -> str:
    text = re.sub(r"[*_`#]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def title_from_filename(name: str) -> str:
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
    return re.sub(r"[-_.]+", " ", stem).strip().title() or "Untitled"


def _split_fenced(md: str):
    """Yield (is_code, line) so callers can skip fenced code blocks."""
    in_code = False
    for line in md.split("\n"):
        if _FENCE.match(line):
            yield True, line
            in_code = not in_code
            continue
        yield in_code, line


def join_hyphenated(md: str) -> str:
    """Join 'exam-\\nple' line-break splits outside code fences."""
    out: list[str] = []
    for in_code, line in _split_fenced(md):
        if (not in_code and out and re.search(r"[a-z]{2}-$", out[-1])
                and re.match(r"^[a-z]", line) and not out[-1].lstrip().startswith(("#", ">", "|"))):
            out[-1] = out[-1][:-1] + line
        else:
            out.append(line)
    return "\n".join(out)


def collapse_blank_lines(md: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+\n", "\n", md)).strip("\n")


_PAGE_NUMBER = re.compile(r"^[\s*_#>]*(?:page\s+)?(\d{1,4}|[ivxlcdm]{1,7})[\s*_]*$", re.I)


def _edge_indices(lines: list[str]) -> list[int]:
    non_empty = [i for i, line in enumerate(lines) if line.strip()]
    return non_empty[:2] + non_empty[-2:] if len(non_empty) > 4 else non_empty


def _furniture_key(line: str) -> str:
    return re.sub(r"\d+", "#", re.sub(r"[*_#`>\s]+", " ", line).strip().lower())


def strip_page_furniture(pages: list[str]) -> list[str]:
    """Drop lone page numbers and running headers/footers.

    A running header/footer is a line (digits normalised) seen among the top/bottom two
    lines of more than 40% of pages. Only edge lines are ever removed.
    """
    split = [p.split("\n") for p in pages]
    counts: dict[str, int] = {}
    for lines in split:
        for key in {_furniture_key(lines[i]) for i in _edge_indices(lines)}:
            if key:
                counts[key] = counts.get(key, 0) + 1
    populated = sum(1 for p in pages if p.strip())
    repeated = {k for k, n in counts.items() if populated >= 5 and n / populated > 0.4}
    result: list[str] = []
    for lines in split:
        drop = set()
        for i in _edge_indices(lines):
            if _PAGE_NUMBER.match(lines[i]) or _furniture_key(lines[i]) in repeated:
                drop.add(i)
        result.append("\n".join(line for i, line in enumerate(lines) if i not in drop))
    return result


# "Chapter 9: ", "Part II - ", "3. " prefixes that a TOC adds but the book's own heading omits.
_TITLE_PREFIX = re.compile(r"^(?:(?:chapter|part|section|book)\s+[\divxlc]+|\d+)\s*[:.\-\u2013\u2014]?\s*", re.I)
# How far into the body the book's own title block may sit (e.g. after a "—— CHAPTER 9 ——" label).
_TITLE_SEARCH_BLOCKS = 3


def _same_title(heading: str, title: str) -> bool:
    h = normalize_title(heading)
    return len(h) >= 4 and h in {normalize_title(title), normalize_title(_TITLE_PREFIX.sub("", title))}


def with_title_heading(title: str, body: str) -> str:
    """Return the chapter body with exactly one H1 title.

    If the book's own title heading appears in the first few blocks (often right after a
    "—— CHAPTER 9 ——" label), keep the book's title block and promote that heading to H1 instead
    of adding a second one; otherwise prepend "# title". The full TOC title stays in frontmatter.
    """
    blocks = body.strip("\n").split("\n\n")
    for i, block in enumerate(blocks[:_TITLE_SEARCH_BLOCKS]):
        m = re.match(r"^#{1,6}\s+(.*)$", block.strip())
        if m and "\n" not in block.strip() and _same_title(m.group(1), title):
            blocks[i] = f"# {m.group(1).strip()}"
            head, rest = "\n\n".join(blocks[: i + 1]), "\n\n".join(blocks[i + 1:])
            return (head + "\n\n" + _below_title(rest)).rstrip() + "\n"
    return f"# {title}\n\n{_below_title(body.strip(chr(10)))}".rstrip() + "\n"


def _below_title(md: str) -> str:
    """Keep the title the only H1: if the body has H1 sections, shift every body heading down a level."""
    if not re.search(r"^# ", md, re.M):
        return md
    out, in_code = [], False
    for line in md.split("\n"):
        if re.match(r"^\s*(```|~~~)", line):
            in_code = not in_code
        if not in_code and re.match(r"^#{1,5} ", line):
            line = "#" + line
        out.append(line)
    return "\n".join(out)
