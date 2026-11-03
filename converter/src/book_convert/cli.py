"""book-convert CLI: PDF/EPUB -> <book-dir>/book.json + <book-dir>/markdown/NN-<slug>.md."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from .events import Emitter


def _detect_format(path: Path) -> str:
    with path.open("rb") as fh:
        head = fh.read(4)
    suffix = path.suffix.lower()
    if suffix == ".pdf" or head == b"%PDF":
        return "pdf"
    if suffix == ".epub" or head == b"PK\x03\x04":
        return "epub"
    raise ValueError(f"unsupported input (expected .pdf or .epub): {path.name}")


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="book-convert", description="Convert a PDF or EPUB into chapter Markdown.")
    p.add_argument("input", type=Path, help="path to a .pdf or .epub")
    p.add_argument("--out", type=Path, required=True, help="book directory to write book.json and markdown/ into")
    p.add_argument("--slug", help="book slug (default: basename of --out)")
    p.add_argument("--json", action="store_true", help="print ConverterEvent JSON lines on stdout")
    p.add_argument("--ocr", choices=["auto", "off", "force"], default="auto", help="OCR policy for PDF pages")
    p.add_argument("--images", action="store_true", help="extract images into <out>/assets/")
    return p


def run(args: argparse.Namespace, emit: Emitter) -> Path:
    src: Path = args.input
    if not src.is_file():
        raise FileNotFoundError(f"input not found: {src}")
    fmt = _detect_format(src)
    book_dir: Path = args.out
    book_dir.mkdir(parents=True, exist_ok=True)
    slug = args.slug or book_dir.resolve().name

    assets = book_dir / "assets"
    shutil.rmtree(assets, ignore_errors=True)
    images_dir = assets if args.images else None
    if images_dir is not None:
        images_dir.mkdir(parents=True, exist_ok=True)

    # Format modules are imported lazily so --help and argument errors stay fast.
    if fmt == "pdf":
        from .pdf_convert import convert_pdf
        extracted = convert_pdf(src, args.ocr, images_dir.resolve() if images_dir else None, emit)
    else:
        from .epub_convert import convert_epub
        extracted = convert_epub(src, images_dir, emit)
    if images_dir is not None and not any(images_dir.iterdir()):
        images_dir.rmdir()

    # An empty result is a failed conversion: the user would otherwise spend quota on nothing.
    from .textclean import count_words
    if sum(count_words(ch.body) for ch in extracted.chapters) == 0:
        raise ValueError("No text found — scanned PDF? Re-run with OCR (--ocr force) or check the file.")

    from .writer import write_book
    return write_book(extracted, src, book_dir, slug, fmt, emit)


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    # Reserve the real stdout for JSON events; library chatter (pymupdf4llm prints to
    # stdout) is redirected to stderr at the file-descriptor level.
    sys.stdout.flush()
    real_stdout_fd = os.dup(1)
    os.dup2(2, 1)
    real_stdout = os.fdopen(real_stdout_fd, "w", encoding="utf-8")
    emit = Emitter(real_stdout if args.json else None)
    try:
        manifest = run(args, emit)
        emit.done("book.json")
        if not args.json:
            print(f"wrote {manifest}", file=real_stdout, flush=True)
        return 0
    except Exception as exc:  # boundary: any failure becomes an error event + exit 1
        emit.error(f"{type(exc).__name__}: {exc}" if not isinstance(exc, (ValueError, FileNotFoundError)) else str(exc))
        return 1
    finally:
        real_stdout.flush()


if __name__ == "__main__":
    sys.exit(main())
