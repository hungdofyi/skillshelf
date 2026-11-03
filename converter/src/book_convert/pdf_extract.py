"""Per-page Markdown extraction for PDFs (pymupdf4llm) with a tesseract OCR fallback."""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import pymupdf
import pymupdf4llm
from pymupdf4llm.ocr import OCRMode

from .events import Emitter
from .pdf_code_blocks import fence_code, monospaced_blocks
from .pdf_drop_caps import (book_vocabulary, compound_hyphens, find_drop_caps, join_split_initials,
                            repair_drop_caps, restore_compound_hyphens)
from .textclean import collapse_blank_lines, join_hyphenated, strip_page_furniture

OCR_MIN_CHARS = 20
BATCH_PAGES = 20
OCR_DPI = 250
# pymupdf4llm leaves a note where it skipped a picture; we drop it.
_PICTURE_NOTE = re.compile(r"^\s*\*{0,2}==>.*picture.*<==\*{0,2}\s*$", re.I | re.M)


def _needs_ocr(page: pymupdf.Page, mode: str) -> bool:
    if mode == "off":
        return False
    if mode == "force":
        return True
    if len(page.get_text().strip()) >= OCR_MIN_CHARS:
        return False
    # Blank pages (no raster content) have nothing to recognise.
    return bool(page.get_images(full=True))


def _ocr_page(page: pymupdf.Page, language: str) -> str:
    tp = page.get_textpage_ocr(language=language, dpi=OCR_DPI, full=True)
    blocks = page.get_text("blocks", textpage=tp, sort=True)
    paragraphs = []
    for block in blocks:
        if block[6] != 0:  # image block
            continue
        text = " ".join(line.strip() for line in str(block[4]).splitlines() if line.strip())
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def _tesseract_ready(emit: Emitter) -> bool:
    try:
        pymupdf.get_tessdata()
        return True
    except Exception as exc:  # pymupdf raises RuntimeError when tessdata is not found
        emit.warn(f"OCR unavailable (tesseract data not found: {exc}); scanned pages will be empty")
        return False


def _tidy(md: str) -> str:
    """Unwrap figure text, drop picture notes, and un-bold headings."""
    md = _PICTURE_NOTE.sub("", md)
    md = re.sub(r"<!-- (?:Start|End) of picture text -->\s*", "\n", md)
    md = md.replace("<br>", "\n")
    # Headings render bold already; drop every bold marker in them (they often hold several runs).
    return re.sub(r"^(#{1,6}[ \t]+)(.*)$", lambda m: m.group(1) + m.group(2).replace("**", "").strip(), md, flags=re.M)


def _md_for_pages(doc: pymupdf.Document, pages: list[int], images_dir: Path | None, emit: Emitter,
                  vocab: Counter[str]) -> dict[int, str]:
    """Run pymupdf4llm on page indices (0-based); returns {index: markdown}."""
    kwargs = dict(page_chunks=True, header=False, footer=False, use_ocr=OCRMode.NEVER)
    if images_dir is not None:
        kwargs.update(write_images=True, image_path=str(images_dir), image_format="png")
    chunks = pymupdf4llm.to_markdown(doc, pages=pages, **kwargs)
    result = {}
    for chunk in chunks:
        index = chunk["metadata"]["page_number"] - 1
        text = _tidy(chunk["text"])
        # Chapter-opening drop caps and split acronym initials ("**M** arket") break first words.
        caps = find_drop_caps(doc[index])
        if caps:
            text = repair_drop_caps(text, caps, vocab)
        text = join_split_initials(text, vocab)
        try:
            text = fence_code(text, monospaced_blocks(doc[index]))
        except Exception as exc:  # code restoration is best-effort
            emit.warn(f"code block restore failed on page {index + 1}: {exc}")
        result[index] = text
    return result


def extract_pages(doc: pymupdf.Document, ocr_mode: str, images_dir: Path | None,
                  emit: Emitter) -> tuple[list[str], int]:
    """Return (markdown per page, number of OCR'd pages), cleaned of page furniture."""
    total = doc.page_count
    ocr_set = {i for i in range(total) if _needs_ocr(doc[i], ocr_mode)}
    if ocr_set and not _tesseract_ready(emit):
        ocr_set = set()
    texts: dict[int, str] = {}
    ocr_done = 0
    vocab = book_vocabulary(doc)

    for i, start in enumerate(range(0, total, BATCH_PAGES)):
        batch = list(range(start, min(start + BATCH_PAGES, total)))
        plain = [p for p in batch if p not in ocr_set]
        if plain:
            try:
                texts.update(_md_for_pages(doc, plain, images_dir, emit, vocab))
            except Exception as exc:  # one bad page must not sink the book: retry singly
                emit.warn(f"extractor failed on pages {plain[0] + 1}-{plain[-1] + 1} ({exc}); retrying page by page")
                for p in plain:
                    try:
                        texts.update(_md_for_pages(doc, [p], images_dir, emit, vocab))
                    except Exception as page_exc:
                        emit.warn(f"page {p + 1} skipped: {page_exc}")
                        texts[p] = ""
        for p in (p for p in batch if p in ocr_set):
            emit.progress("ocr", ocr_done + 1, len(ocr_set), f"page {p + 1}")
            try:
                texts[p] = _ocr_page(doc[p], "eng")
                if texts[p].strip():
                    ocr_done += 1
            except Exception as exc:
                emit.warn(f"OCR failed on page {p + 1}: {exc}")
                texts[p] = ""
        emit.progress("extract", batch[-1] + 1, total)

    pages = [texts.get(i, "") for i in range(total)]
    pages = strip_page_furniture(pages)
    if images_dir is not None:
        # image links are written with the absolute assets path; chapters live in markdown/
        pages = [p.replace(str(images_dir) + "/", "../assets/") for p in pages]
    pages = [join_hyphenated(collapse_blank_lines(p)) for p in pages]
    # Line-break hyphens of real compounds ('well-⏎known') get dropped by extraction; put them back.
    compounds = compound_hyphens(doc, vocab)
    pages = [restore_compound_hyphens(p, compounds) for p in pages]
    return pages, ocr_done
