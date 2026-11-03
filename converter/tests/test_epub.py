from conftest import make_epub

CHAPTERS = [("The First Step", "alpha"), ("The Second Step", "beta"), ("The Third Step", "gamma")]


def check(r):
    assert r.proc.returncode == 0, r.proc.stderr
    m = r.manifest
    assert r.events[-1] == {"type": "done", "manifest": "book.json"}
    assert m["title"] == "Sample EPUB" and m["authors"] == ["Cy Author"] and m["language"] == "en"
    assert m["source"]["format"] == "epub" and "pages" not in m["source"]
    assert m["converter"]["engine"] == "epub-markdownify"
    assert [c["title"] for c in m["chapters"]] == [t for t, _ in CHAPTERS]
    assert all("pages" not in c and c["words"] > 100 for c in m["chapters"])
    return m


def test_epub3_nav(tmp_path, convert):
    r = convert(make_epub(tmp_path / "b.epub", CHAPTERS, "nav"))
    m = check(r)
    text = (r.out / m["chapters"][0]["file"]).read_text()
    assert text.startswith('---\ntitle: "The First Step"')
    body = text.split("---\n", 2)[2]
    assert body.lstrip().startswith("# The First Step")
    assert body.count("# The First Step") == 1  # heading not duplicated
    assert "```" in body and "code line 0" in body  # <pre> becomes a fenced block
    assert "[link]" not in body and "link" in body  # internal link flattened to text


def test_epub2_ncx(tmp_path, convert):
    check(convert(make_epub(tmp_path / "b.epub", CHAPTERS, "ncx")))


def test_epub_chapters_split_by_anchor_in_one_file(tmp_path, convert):
    r = convert(make_epub(tmp_path / "b.epub", CHAPTERS, "nav", single_file=True))
    m = check(r)
    third = (r.out / m["chapters"][2]["file"]).read_text()
    assert "gamma" in third and "alpha" not in third and "beta" not in third


def test_epub_without_toc_uses_spine(tmp_path, convert):
    r = convert(make_epub(tmp_path / "b.epub", CHAPTERS, "none"))
    assert r.proc.returncode == 0
    assert any(e["type"] == "warning" for e in r.events)
    assert [c["title"] for c in r.manifest["chapters"]] == [t for t, _ in CHAPTERS]


def test_epub_source_inside_book_dir_is_relative(tmp_path, convert):
    book = tmp_path / "lib" / "my-book"
    (book / "source").mkdir(parents=True)
    src = make_epub(book / "source" / "b.epub", CHAPTERS, "nav")
    r = convert(src, out=book)
    assert r.manifest["source"]["file"] == "source/b.epub"
    assert r.manifest["slug"] == "my-book"


def test_bad_epub_emits_error(tmp_path, convert):
    bad = tmp_path / "bad.epub"
    bad.write_bytes(b"not a zip")
    r = convert(bad)
    assert r.proc.returncode == 1 and r.events[-1]["type"] == "error"


_ENC = ("<encryption xmlns='urn:oasis:names:tc:opendocument:xmlns:container' xmlns:enc='http://www.w3.org/2001/04/xmlenc#'>"
        "<enc:EncryptedData><enc:EncryptionMethod Algorithm='{alg}'/>"
        "<enc:CipherData><enc:CipherReference URI='{uri}'/></enc:CipherData></enc:EncryptedData></encryption>")


def test_drm_epub_is_refused(tmp_path, convert):
    xml = _ENC.format(alg="http://www.w3.org/2001/04/xmlenc#aes128-cbc", uri="OEBPS/ch0.xhtml")
    r = convert(make_epub(tmp_path / "b.epub", CHAPTERS, "nav", encryption_xml=xml))
    assert r.proc.returncode == 1
    assert r.events[-1] == {"type": "error", "message": "This EPUB is DRM-protected; remove DRM or use a DRM-free copy."}


def test_font_obfuscation_is_not_drm(tmp_path, convert):
    xml = _ENC.format(alg="http://www.idpf.org/2008/embedding", uri="OEBPS/fonts/a.otf")
    r = convert(make_epub(tmp_path / "b.epub", CHAPTERS, "nav", encryption_xml=xml))
    assert r.proc.returncode == 0, r.proc.stderr

