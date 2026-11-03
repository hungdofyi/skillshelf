"""EPUB container parsing with zipfile + lxml: OPF metadata, spine and TOC (nav or NCX)."""

from __future__ import annotations

import posixpath
import warnings
import zipfile
from dataclasses import dataclass, field
from urllib.parse import unquote, urldefrag

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from lxml import etree

# XHTML is deliberately parsed leniently with the HTML parser.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
_XML = etree.XMLParser(resolve_entities=False, no_network=True, recover=True, huge_tree=False)
NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "ncx": "http://www.daisy.org/z3986/2005/ncx/",
}
# Zip-bomb guard: a single member larger than this is refused.
MAX_MEMBER_BYTES = 200 * 1024 * 1024


@dataclass
class TocEntry:
    title: str
    href: str  # zip-internal path (no fragment)
    fragment: str
    level: int


@dataclass
class EpubPackage:
    zf: zipfile.ZipFile
    title: str = ""
    authors: list[str] = field(default_factory=list)
    language: str | None = None
    spine: list[str] = field(default_factory=list)  # zip-internal paths in reading order
    media_types: dict[str, str] = field(default_factory=dict)
    toc: list[TocEntry] = field(default_factory=list)

    def read(self, name: str) -> bytes:
        info = self.zf.getinfo(name)
        if info.file_size > MAX_MEMBER_BYTES:
            raise ValueError(f"EPUB member too large: {name}")
        return self.zf.read(name)


# Font obfuscation is not DRM: it only scrambles embedded fonts and the text stays readable.
_FONT_OBFUSCATION = {"http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"}
_CONTENT_TYPES = {"application/xhtml+xml", "text/html", "application/x-dtbook+xml"}


def _assert_not_drm(pkg: "EpubPackage") -> None:
    """Refuse EPUBs whose encryption.xml encrypts content documents (not just fonts)."""
    if "META-INF/encryption.xml" not in pkg.zf.namelist():
        return
    root = etree.fromstring(pkg.read("META-INF/encryption.xml"), _XML)
    spine = set(pkg.spine)
    for enc in root.iter("{*}EncryptedData"):
        method = enc.find("{*}EncryptionMethod")
        ref = enc.find(".//{*}CipherReference")
        if ref is None or not ref.get("URI"):
            continue
        if method is not None and method.get("Algorithm") in _FONT_OBFUSCATION:
            continue
        uri = posixpath.normpath(unquote(ref.get("URI")))
        if uri in spine or pkg.media_types.get(uri) in _CONTENT_TYPES:
            raise ValueError("This EPUB is DRM-protected; remove DRM or use a DRM-free copy.")


def _resolve(base_dir: str, href: str) -> tuple[str, str]:
    path, frag = urldefrag(href)
    return posixpath.normpath(posixpath.join(base_dir, unquote(path))), unquote(frag)


def _text(el) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def _nav_entries(nav_ol, base_dir: str, level: int, out: list[TocEntry]) -> None:
    for li in nav_ol.find_all("li", recursive=False):
        link = li.find(["a", "span"], recursive=False)
        a = li.find("a", recursive=False)
        if a is not None and a.get("href"):
            path, frag = _resolve(base_dir, a["href"])
            out.append(TocEntry(" ".join(a.get_text().split()), path, frag, level))
        elif link is not None:
            out.append(TocEntry(" ".join(link.get_text().split()), "", "", level))
        sub = li.find(["ol", "ul"], recursive=False)
        if sub is not None:
            _nav_entries(sub, base_dir, level + 1, out)


def _parse_nav(data: bytes, nav_path: str) -> list[TocEntry]:
    soup = BeautifulSoup(data, "lxml")
    nav = next((n for n in soup.find_all("nav") if "toc" in (n.get("epub:type") or "").split()), None)
    if nav is None:
        return []
    ol = nav.find(["ol", "ul"])
    out: list[TocEntry] = []
    if ol is not None:
        _nav_entries(ol, posixpath.dirname(nav_path), 1, out)
    return out


def _ncx_entries(parent, base_dir: str, level: int, out: list[TocEntry]) -> None:
    for point in parent.findall("ncx:navPoint", NS):
        content = point.find("ncx:content", NS)
        label = _text(point.find("ncx:navLabel/ncx:text", NS))
        if content is not None and content.get("src"):
            path, frag = _resolve(base_dir, content.get("src"))
            out.append(TocEntry(label, path, frag, level))
        _ncx_entries(point, base_dir, level + 1, out)


def open_epub(path) -> EpubPackage:
    zf = zipfile.ZipFile(path)
    pkg = EpubPackage(zf)
    container = etree.fromstring(pkg.read("META-INF/container.xml"), _XML)
    rootfile = container.find(".//c:rootfile", NS)
    if rootfile is None or not rootfile.get("full-path"):
        raise ValueError("EPUB container.xml has no rootfile")
    opf_path = posixpath.normpath(unquote(rootfile.get("full-path")))
    opf_dir = posixpath.dirname(opf_path)
    opf = etree.fromstring(pkg.read(opf_path), _XML)

    pkg.title = _text(opf.find(".//dc:title", NS))
    pkg.authors = [t for t in (_text(e) for e in opf.findall(".//dc:creator", NS)) if t]
    lang = _text(opf.find(".//dc:language", NS))
    pkg.language = lang or None

    items: dict[str, tuple[str, str, str]] = {}  # id -> (path, media-type, properties)
    for item in opf.findall(".//opf:manifest/opf:item", NS):
        if item.get("id") and item.get("href"):
            href = posixpath.normpath(posixpath.join(opf_dir, unquote(urldefrag(item.get("href"))[0])))
            items[item.get("id")] = (href, item.get("media-type", ""), item.get("properties", ""))
            pkg.media_types[href] = item.get("media-type", "")
    for ref in opf.findall(".//opf:spine/opf:itemref", NS):
        if ref.get("idref") in items:
            pkg.spine.append(items[ref.get("idref")][0])

    _assert_not_drm(pkg)

    nav_path = next((p for p, _, props in items.values() if "nav" in props.split()), None)
    if nav_path and nav_path in pkg.zf.namelist():
        pkg.toc = _parse_nav(pkg.read(nav_path), nav_path)
    if not pkg.toc:
        spine_el = opf.find(".//opf:spine", NS)
        ncx_id = spine_el.get("toc") if spine_el is not None else None
        ncx_path = items[ncx_id][0] if ncx_id in items else next(
            (p for p, mt, _ in items.values() if mt == "application/x-dtbncx+xml"), None)
        if ncx_path and ncx_path in pkg.zf.namelist():
            ncx = etree.fromstring(pkg.read(ncx_path), _XML)
            nav_map = ncx.find("ncx:navMap", NS)
            if nav_map is not None:
                _ncx_entries(nav_map, posixpath.dirname(ncx_path), 1, pkg.toc)
    return pkg
