"""Write chapter Markdown files and book.json (BookManifest) into a book folder."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from .events import Emitter
from .model import Extracted
from .textclean import count_words, slugify, with_title_heading

SCHEMA_VERSION = 1


def _version() -> str:
    try:
        return version("book-convert")
    except PackageNotFoundError:
        return "0.0.0"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _source_rel(input_path: Path, book_dir: Path) -> str:
    try:
        return input_path.resolve().relative_to(book_dir.resolve()).as_posix()
    except ValueError:
        return input_path.name


def _frontmatter(title: str, book: str, index: int, pages: tuple[int, int] | None) -> str:
    lines = ["---", f"title: {json.dumps(title, ensure_ascii=False)}", f"book: {json.dumps(book, ensure_ascii=False)}",
             f"chapter: {index}"]
    if pages:
        lines.append(f'pages: "{pages[0]}-{pages[1]}"')
    return "\n".join(lines + ["---", ""])


def write_book(ex: Extracted, input_path: Path, book_dir: Path, slug: str, fmt: str,
               emit: Emitter) -> Path:
    md_dir = book_dir / "markdown"
    shutil.rmtree(md_dir, ignore_errors=True)
    md_dir.mkdir(parents=True, exist_ok=True)

    width = max(2, len(str(len(ex.chapters))))
    chapters_meta = []
    total_words = 0
    for index, ch in enumerate(ex.chapters):
        emit.progress("write", index + 1, len(ex.chapters), ch.title)
        rel = f"markdown/{index + 1:0{width}d}-{slugify(ch.title)}.md"
        text = _frontmatter(ch.title, ex.title, index, ch.pages) + "\n" + with_title_heading(ch.title, ch.body)
        (book_dir / rel).write_text(text, encoding="utf-8")
        words = count_words(ch.body)
        total_words += words
        meta = {"index": index, "title": ch.title, "file": rel, "level": ch.level}
        if ch.pages:
            meta["pages"] = list(ch.pages)
        meta["words"] = words
        chapters_meta.append(meta)

    source = {"file": _source_rel(input_path, book_dir), "format": fmt,
              "sha256": _sha256(input_path), "bytes": input_path.stat().st_size}
    if ex.source_pages is not None:
        source["pages"] = ex.source_pages
    manifest: dict = {"schemaVersion": SCHEMA_VERSION, "slug": slug, "title": ex.title, "authors": ex.authors}
    if ex.language:
        manifest["language"] = ex.language
    manifest.update({
        "source": source,
        "converter": {"engine": ex.engine, "version": _version(), "ocrPages": ex.ocr_pages,
                      "convertedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")},
        "chapters": chapters_meta,
        "stats": {"words": total_words, "warnings": list(emit.warnings)},
    })
    out = book_dir / "book.json"
    tmp = book_dir / "book.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(out)
    return out
