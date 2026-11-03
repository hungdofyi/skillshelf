"""Fixture builders: all test books are generated, none are copyrighted files."""

from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pymupdf
import pytest

LOREM = ("Onboarding converts new users into active ones when the first session delivers value quickly. " * 8)


def make_pdf(path: Path, chapters: list[str], toc: bool, pages_per_chapter: int = 2, front_words: int = 0) -> Path:
    doc = pymupdf.open()
    entries = []
    if front_words:
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(72, 72, 540, 700), ("preface word " * front_words), fontsize=10)
    for title in chapters:
        first = doc.page_count + 1
        for n in range(pages_per_chapter):
            page = doc.new_page()
            if n == 0:
                page.insert_text((72, 110), title, fontsize=24)
            page.insert_text((72, 40), "Running Header", fontsize=8)
            page.insert_textbox(pymupdf.Rect(72, 150, 540, 700), LOREM + f" ({title} p{n})", fontsize=11)
            page.insert_text((300, 780), str(doc.page_count), fontsize=8)
        entries.append([1, title, first])
    if toc:
        doc.set_toc(entries)
    doc.set_metadata({"title": "Test Book", "author": "Ann Author; Bob Writer"})
    doc.save(path)
    return path


def make_epub(path: Path, chapters: list[tuple[str, str]], style: str = "nav", single_file: bool = False,
              encryption_xml: str | None = None) -> Path:
    """chapters: (title, html body paragraph text). style: nav | ncx | none."""
    para = " ".join(["Reading text for the chapter."] * 40)
    files: dict[str, str] = {}
    manifest, spine = [], []
    if single_file:
        body = "".join(f'<h1 id="c{i}">{t}</h1><p>{para} {text}</p>' for i, (t, text) in enumerate(chapters))
        files["OEBPS/all.xhtml"] = f"<html xmlns='http://www.w3.org/1999/xhtml'><body>{body}</body></html>"
        manifest.append('<item id="all" href="all.xhtml" media-type="application/xhtml+xml"/>')
        spine.append('<itemref idref="all"/>')
        targets = [f"all.xhtml#c{i}" for i in range(len(chapters))]
    else:
        targets = []
        for i, (t, text) in enumerate(chapters):
            files[f"OEBPS/ch{i}.xhtml"] = (
                f"<html xmlns='http://www.w3.org/1999/xhtml'><body><h1>{t}</h1><p>{para} {text}</p>"
                f"<pre>code line {i}</pre><a href='ch0.xhtml'>link</a></body></html>")
            manifest.append(f'<item id="c{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="c{i}"/>')
            targets.append(f"ch{i}.xhtml")
    spine_attr = ""
    if style == "nav":
        items = "".join(f'<li><a href="{h}">{t}</a></li>' for (t, _), h in zip(chapters, targets))
        files["OEBPS/nav.xhtml"] = (
            "<html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'><body>"
            f"<nav epub:type='toc'><ol>{items}</ol></nav></body></html>")
        manifest.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
    elif style == "ncx":
        points = "".join(
            f'<navPoint id="n{i}"><navLabel><text>{t}</text></navLabel><content src="{h}"/></navPoint>'
            for i, ((t, _), h) in enumerate(zip(chapters, targets)))
        files["OEBPS/toc.ncx"] = (
            f"<ncx xmlns='http://www.daisy.org/z3986/2005/ncx/'><navMap>{points}</navMap></ncx>")
        manifest.append('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')
        spine_attr = ' toc="ncx"'
    opf = (
        "<package xmlns='http://www.idpf.org/2007/opf' version='3.0'>"
        "<metadata xmlns:dc='http://purl.org/dc/elements/1.1/'><dc:title>Sample EPUB</dc:title>"
        "<dc:creator>Cy Author</dc:creator><dc:language>en</dc:language></metadata>"
        f"<manifest>{''.join(manifest)}</manifest><spine{spine_attr}>{''.join(spine)}</spine></package>")
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml",
                    "<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container' version='1.0'><rootfiles>"
                    "<rootfile full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/>"
                    "</rootfiles></container>")
        zf.writestr("OEBPS/content.opf", opf)
        if encryption_xml is not None:
            zf.writestr("META-INF/encryption.xml", encryption_xml)
        for name, data in files.items():
            zf.writestr(name, data)
    return path


class Result:
    def __init__(self, proc: subprocess.CompletedProcess, out: Path):
        self.proc, self.out = proc, out
        self.events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]

    @property
    def manifest(self) -> dict:
        return json.loads((self.out / "book.json").read_text())


@pytest.fixture
def convert(tmp_path):
    """Run the CLI as a subprocess (the way the server does) and parse its JSON lines."""
    def run(src: Path, *extra: str, out: Path | None = None) -> Result:
        out = out or tmp_path / "book"
        proc = subprocess.run(
            [sys.executable, "-I", "-m", "book_convert.cli", str(src), "--out", str(out), "--json", *extra],
            capture_output=True, text=True, timeout=300)
        return Result(proc, out)
    return run
