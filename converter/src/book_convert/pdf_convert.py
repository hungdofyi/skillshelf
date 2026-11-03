"""PDF -> chapters: TOC split, heading split, or fixed-size parts."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from .events import Emitter
from .pdf_normalize import normalize_chapter
from .model import Chapter, Extracted
from .pdf_extract import extract_pages
from .textclean import (FRONT_MATTER_MIN_WORDS, clean_title, collapse_blank_lines, count_words,
                        title_from_filename)

PART_PAGES = 20
_CONTENTS_TITLE = re.compile(r"^(table of )?contents$", re.I)
_JUNK_TITLE = re.compile(r"(\.(docx?|indd|pdf|tex|pages)$|^untitled|^microsoft word)", re.I)


def _metadata(doc: pymupdf.Document, filename: str) -> tuple[str, list[str]]:
    meta = doc.metadata or {}
    title = (meta.get("title") or "").strip()
    if not title or _JUNK_TITLE.search(title):
        title = title_from_filename(filename)
    author = (meta.get("author") or "").strip()
    authors = [a.strip() for a in re.split(r";|\sand\s|&", author) if a.strip()]
    return title, authors


@dataclass
class _Node:
    title: str
    page: int
    level: int
    end: int = 0  # exclusive upper bound of its own span (next entry at same/higher level)
    children: list["_Node"] = field(default_factory=list)


@dataclass
class _Entry:
    title: str
    start: int  # 1-based page
    level: int
    lead: bool = False  # parent's own pages before its first child (e.g. a "Part I" title page)


EXPAND_SPAN_PAGES = 60  # a level-2 entry with children is split further only if longer than this


def _toc_tree(doc: pymupdf.Document) -> list[_Node]:
    total = doc.page_count
    valid = [_Node(clean_title(t), p, lvl) for lvl, t, p in doc.get_toc() if 1 <= p <= total and clean_title(t)]
    for i, node in enumerate(valid):
        node.end = next((n.page for n in valid[i + 1:] if n.level <= node.level), total + 1)
    roots: list[_Node] = []
    stack: list[_Node] = []
    for node in valid:
        while stack and stack[-1].level >= node.level:
            stack.pop()
        (stack[-1].children if stack else roots).append(node)
        stack.append(node)
    return roots


_PART_TITLE = re.compile(r"^(part|book|unit|volume|section)\b", re.I)


def _is_container(n: _Node, pages: list[str]) -> bool:
    """A "Part"-style grouping: named like one, or a title page with almost no text before its first child.

    Ordinary chapters that merely contain sections (child on the same page, or real intro text)
    stay whole.
    """
    if not n.children:
        return False
    if _PART_TITLE.match(n.title):
        return True
    first = n.children[0].page
    return first > n.page and count_words("\n".join(pages[n.page - 1 : first - 1])) < FRONT_MATTER_MIN_WORDS


def _flatten(nodes: list[_Node], pages: list[str], depth: int = 1) -> list[_Entry]:
    """Replace Part-like parents by their chapters (one more level only for very long spans)."""
    out: list[_Entry] = []
    for n in nodes:
        expand = bool(n.children) and (
            _is_container(n, pages) if depth == 1 else depth == 2 and n.end - n.page > EXPAND_SPAN_PAGES)
        if expand:
            if n.children[0].page > n.page:
                out.append(_Entry(n.title, n.page, n.level, lead=True))
            out.extend(_flatten(n.children, pages, depth + 1))
        else:
            out.append(_Entry(n.title, n.page, n.level))
    return out


def _toc_entries(doc: pymupdf.Document, pages: list[str], emit: Emitter) -> list[_Entry]:
    entries: list[_Entry] = []
    for e in sorted(_flatten(_toc_tree(doc), pages), key=lambda e: e.start):  # stable: TOC order on ties
        if entries and entries[-1].start == e.start:
            emit.warn(f"TOC entries '{entries[-1].title}' and '{e.title}' start on page {e.start}; keeping the first")
            continue
        entries.append(e)
    return entries


def _heading_entries(pages: list[str]) -> list[tuple[str, int]]:
    entries: list[tuple[str, int]] = []
    for idx, text in enumerate(pages):
        m = re.search(r"^# +(.+?)\s*$", text, re.M)
        if m and clean_title(m.group(1)):
            entries.append((clean_title(m.group(1)), idx + 1))
    return entries


def _build(pages: list[str], entries: list[_Entry], emit: Emitter, drop_short: bool) -> list[Chapter]:
    chapters: list[Chapter] = []
    first = entries[0].start
    if first > 1:
        front = normalize_chapter(collapse_blank_lines("\n\n".join(pages[: first - 1])))
        if count_words(front) > FRONT_MATTER_MIN_WORDS:
            chapters.append(Chapter("Front matter", 1, front, (1, first - 1)))
    merge_from: int | None = None  # start page of a kept lead section to prepend to the next chapter
    candidates: list[Chapter] = []
    for i, e in enumerate(entries):
        end = max(entries[i + 1].start - 1 if i + 1 < len(entries) else len(pages), e.start)
        start = e.start
        body = normalize_chapter(collapse_blank_lines("\n\n".join(pages[start - 1 : end])))
        if e.lead:
            if count_words(body) >= FRONT_MATTER_MIN_WORDS:
                merge_from = start
            continue
        if merge_from is not None:
            start = merge_from
            body = normalize_chapter(collapse_blank_lines("\n\n".join(pages[start - 1 : end])))
            merge_from = None
        candidates.append(Chapter(e.title, e.level, body, (start, end)))
    kept = [c for c in candidates
            if not drop_short or (count_words(c.body) >= FRONT_MATTER_MIN_WORDS and not _CONTENTS_TITLE.match(c.title))]
    if drop_short and kept:
        for c in candidates:
            if c not in kept:
                emit.warn(f"dropped near-empty/contents section '{c.title}' (pages {c.pages[0]}-{c.pages[1]})")
        candidates = kept
    return chapters + candidates


def convert_pdf(path: Path, ocr_mode: str, images_dir: Path | None, emit: Emitter) -> Extracted:
    """Convert a PDF with pymupdf4llm, then split into chapters by its outline."""
    emit.progress("open", message=path.name)
    doc = pymupdf.open(path)
    try:
        if doc.needs_pass:
            raise ValueError("PDF is password protected")
        if doc.page_count == 0:
            raise ValueError("PDF has no pages")
        title, authors = _metadata(doc, path.name)
        pages, ocr_pages = extract_pages(doc, ocr_mode, images_dir, emit)
        emit.progress("split", message="chapters")
        entries = _toc_entries(doc, pages, emit)
    finally:
        doc.close()

    from_toc = bool(entries)
    if not entries:
        emit.warn("no usable PDF outline; splitting on top-level headings")
        entries = [_Entry(t, p, 1) for t, p in _heading_entries(pages)]
        if len(entries) < 3:
            emit.warn(f"fewer than 3 top-level headings found; splitting into ~{PART_PAGES}-page parts")
            total = len(pages)
            entries = [_Entry(f"Pages {s}–{min(s + PART_PAGES - 1, total)}", s, 1)
                       for s in range(1, total + 1, PART_PAGES)]
    chapters = _build(pages, entries, emit, drop_short=from_toc)
    return Extracted("pymupdf4llm", title, authors, chapters, source_pages=len(pages), ocr_pages=ocr_pages)
