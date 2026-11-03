"""XHTML -> Markdown for EPUB spine documents, with chapter-start sentinels."""

from __future__ import annotations

import posixpath
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup, NavigableString
from markdownify import MarkdownConverter

from .epub_package import EpubPackage

# Private-use characters never occur in book text and survive markdownify untouched.
SENTINEL_OPEN, SENTINEL_CLOSE = "", ""
SENTINEL_RE = re.compile(f"{SENTINEL_OPEN}(\\d+){SENTINEL_CLOSE}")


def sentinel(n: int) -> str:
    return f"{SENTINEL_OPEN}{n}{SENTINEL_CLOSE}"


class _Converter(MarkdownConverter):
    """Internal links become plain text; images become assets or a short placeholder."""

    def __init__(self, doc_path: str, pkg: EpubPackage, images_dir: Path | None, **kw):
        super().__init__(**kw)
        self._doc_dir = posixpath.dirname(doc_path)
        self._pkg = pkg
        self._images_dir = images_dir

    def convert_a(self, el, text, parent_tags=None, **kw):
        href = el.get("href", "")
        if not href or not urlparse(href).scheme or urlparse(href).scheme == "mailto":
            return text  # internal link / anchor / footnote ref: keep the text only
        return super().convert_a(el, text, parent_tags=parent_tags, **kw)

    def convert_img(self, el, text, parent_tags=None, **kw):
        alt = " ".join((el.get("alt") or "").split())
        src = el.get("src", "")
        if self._images_dir is not None and src and not urlparse(src).scheme:
            name = posixpath.normpath(posixpath.join(self._doc_dir, unquote(urlparse(src).path)))
            if name in self._pkg.zf.namelist():
                target = self._images_dir / re.sub(r"[^A-Za-z0-9._-]+", "_", name.replace("/", "_"))
                self._images_dir.mkdir(parents=True, exist_ok=True)
                target.write_bytes(self._pkg.read(name))
                return f"![{alt}](../assets/{target.name})"
        return f"*[Image: {alt}]*" if alt else ""


def spine_doc_to_markdown(pkg: EpubPackage, doc_path: str, starts: dict[str, int],
                          images_dir: Path | None) -> tuple[str, set[str]]:
    """Convert one spine document.

    `starts` maps fragment id ("" = document start) -> chapter number; a sentinel is
    inserted before each matching element. Returns (markdown, fragments not found).
    """
    soup = BeautifulSoup(pkg.read(doc_path), "lxml")
    for tag in soup(["script", "style", "nav", "head"]):
        tag.decompose()
    body = soup.body or soup
    missing: set[str] = set()
    for frag, number in starts.items():
        marker = NavigableString(sentinel(number))
        target = body.find(id=frag) if frag else None
        if target is not None:
            target.insert_before(marker)
        else:
            if frag:
                missing.add(frag)
            body.insert(0, marker)
    md = _Converter(doc_path, pkg, images_dir, heading_style="ATX", bullets="-",
                    escape_misc=False, code_language="").convert_soup(body)
    return md, missing
