"""EPUB -> chapters. TOC targets (spine file + fragment) mark chapter starts."""

from __future__ import annotations

import posixpath
import re
from pathlib import Path

from .epub_html import SENTINEL_RE, spine_doc_to_markdown
from .epub_package import EpubPackage, TocEntry, open_epub
from .events import Emitter
from .model import Chapter, Extracted
from .textclean import FRONT_MATTER_MIN_WORDS, clean_title, collapse_blank_lines, count_words, title_from_filename


def _top_level(toc: list[TocEntry]) -> list[TocEntry]:
    top = [e for e in toc if e.level == 1]
    if len(top) == 1 and any(e.level == 2 for e in toc):  # book-title wrapper
        return [e for e in toc if e.level == 2]
    return top


def _first_heading(md: str) -> str | None:
    m = re.search(r"^#{1,6}\s+(.+?)\s*$", md, re.M)
    return clean_title(m.group(1)) if m else None


def _plan_from_toc(pkg: EpubPackage, emit: Emitter) -> list[tuple[str, str, str, int]]:
    """Return [(title, spine path, fragment, level)] for usable top-level TOC entries."""
    plan = []
    for entry in _top_level(pkg.toc):
        title = clean_title(entry.title)
        if entry.href not in pkg.spine:
            emit.warn(f"TOC entry '{title}' points outside the spine ({entry.href}); skipped")
            continue
        if title:
            plan.append((title, entry.href, entry.fragment, entry.level))
    return plan


def convert_epub(path: Path, images_dir: Path | None, emit: Emitter) -> Extracted:
    emit.progress("open", message=path.name)
    pkg = open_epub(path)
    try:
        if not pkg.spine:
            raise ValueError("EPUB has an empty spine")
        plan = _plan_from_toc(pkg, emit)
        if not plan:
            emit.warn("no usable EPUB table of contents; using one chapter per spine document")

        # chapter number -> (title, level); sentinels mark each chapter start in its document
        starts_by_doc: dict[str, dict[str, int]] = {}
        for number, (_, doc, frag, _lvl) in enumerate(plan):
            starts_by_doc.setdefault(doc, {})[frag] = number

        stream: list[str] = []
        spine_titles: list[tuple[str, str]] = []  # no-TOC mode: (title, markdown)
        total = len(pkg.spine)
        for i, doc in enumerate(pkg.spine):
            emit.progress("extract", i + 1, total, posixpath.basename(doc))
            if pkg.media_types.get(doc, "") not in ("application/xhtml+xml", "text/html", ""):
                continue
            try:
                md, missing = spine_doc_to_markdown(pkg, doc, starts_by_doc.get(doc, {}), images_dir)
            except Exception as exc:
                emit.warn(f"could not convert {doc}: {exc}")
                continue
            for frag in missing:
                emit.warn(f"fragment #{frag} not found in {posixpath.basename(doc)}; chapter starts at file start")
            if plan:
                stream.append(md)
            else:
                spine_titles.append((_first_heading(md) or title_from_filename(posixpath.basename(doc)), md))
    finally:
        pkg.zf.close()

    emit.progress("split", message="chapters")
    chapters: list[Chapter] = []
    if plan:
        chapters = _split_stream("\n".join(stream), plan, emit)
    else:
        for title, md in spine_titles:
            body = collapse_blank_lines(md)
            if count_words(body) > 0:
                chapters.append(Chapter(title, 1, body))
    if not chapters:
        raise ValueError("no readable chapters found in EPUB")
    title = clean_title(pkg.title) or title_from_filename(path.name)
    return Extracted("epub-markdownify", title, pkg.authors, chapters, language=pkg.language)


def _split_stream(stream: str, plan: list[tuple[str, str, str, int]], emit: Emitter) -> list[Chapter]:
    """Cut the concatenated spine Markdown at chapter sentinels, in document order."""
    marks = [(m.start(), m.end(), int(m.group(1))) for m in SENTINEL_RE.finditer(stream)]
    chapters: list[Chapter] = []
    head = collapse_blank_lines(SENTINEL_RE.sub("", stream[: marks[0][0]] if marks else stream))
    if count_words(head) > FRONT_MATTER_MIN_WORDS:
        chapters.append(Chapter("Front matter", 1, head))
    for i, (_, end, number) in enumerate(marks):
        stop = marks[i + 1][0] if i + 1 < len(marks) else len(stream)
        body = collapse_blank_lines(SENTINEL_RE.sub("", stream[end:stop]))
        title, _, _, level = plan[number]
        if count_words(body) == 0:
            emit.warn(f"chapter '{title}' is empty; dropped")
            continue
        chapters.append(Chapter(title, level, body))
    return chapters
