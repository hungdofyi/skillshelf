import shutil

import pymupdf
import pytest

from conftest import make_pdf

TITLES = ["Alpha Basics", "Beta Methods", "Gamma Results"]


def test_pdf_with_toc(tmp_path, convert):
    src = make_pdf(tmp_path / "in.pdf", TITLES, toc=True)
    r = convert(src)
    assert r.proc.returncode == 0, r.proc.stderr
    assert all(e["type"] in {"progress", "warning", "done", "error"} for e in r.events)
    assert r.events[-1] == {"type": "done", "manifest": "book.json"}
    assert {"open", "extract", "split", "write"} <= {e["stage"] for e in r.events if e["type"] == "progress"}
    m = r.manifest
    assert m["schemaVersion"] == 1 and m["title"] == "Test Book"
    assert m["authors"] == ["Ann Author", "Bob Writer"]
    assert m["source"]["format"] == "pdf" and m["source"]["pages"] == 6 and len(m["source"]["sha256"]) == 64
    assert m["source"]["file"] == "in.pdf"
    assert m["converter"]["engine"] == "pymupdf4llm" and m["converter"]["ocrPages"] == 0
    assert [c["title"] for c in m["chapters"]] == TITLES
    assert [c["pages"] for c in m["chapters"]] == [[1, 2], [3, 4], [5, 6]]
    assert [c["file"] for c in m["chapters"]] == [f"markdown/0{i + 1}-{s}.md" for i, s in
                                                  enumerate(["alpha-basics", "beta-methods", "gamma-results"])]
    assert all(c["words"] > 50 for c in m["chapters"])
    assert m["stats"]["words"] == sum(c["words"] for c in m["chapters"])
    text = (r.out / m["chapters"][1]["file"]).read_text()
    assert text.startswith('---\ntitle: "Beta Methods"\nbook: "Test Book"\nchapter: 1\npages: "3-4"\n---\n')
    body = text.split("---\n", 2)[2]
    assert body.lstrip().startswith("# Beta Methods")
    assert "Running Header" not in text  # running header removed


def test_pdf_without_toc_falls_back_to_parts(tmp_path, convert):
    src = make_pdf(tmp_path / "flat.pdf", ["Only One"], toc=False, pages_per_chapter=3)
    r = convert(src)
    assert r.proc.returncode == 0
    assert any(e["type"] == "warning" for e in r.events)
    m = r.manifest
    assert len(m["chapters"]) == 1 and m["chapters"][0]["pages"] == [1, 3]
    assert m["chapters"][0]["title"].startswith("Pages 1")
    assert m["stats"]["warnings"]


def test_pdf_without_toc_splits_on_headings(tmp_path, convert):
    src = make_pdf(tmp_path / "flat.pdf", TITLES, toc=False)
    r = convert(src)
    assert [c["title"] for c in r.manifest["chapters"]] == TITLES


def test_front_matter_kept_when_long(tmp_path, convert):
    src = make_pdf(tmp_path / "fm.pdf", TITLES, toc=True, front_words=200)
    m = convert(src).manifest
    assert m["chapters"][0]["title"] == "Front matter" and m["chapters"][0]["pages"] == [1, 1]
    assert [c["index"] for c in m["chapters"]] == [0, 1, 2, 3]


def test_rerun_cleans_old_files(tmp_path, convert):
    out = tmp_path / "keep"
    convert(make_pdf(tmp_path / "a.pdf", TITLES, toc=True), out=out)
    (out / "markdown" / "stale.md").write_text("old")
    r = convert(make_pdf(tmp_path / "b.pdf", TITLES[:2] + ["Delta Extra", "Epsilon Last"], toc=True), out=out)
    names = sorted(p.name for p in (out / "markdown").iterdir())
    assert "stale.md" not in names and len(names) == 4
    assert len(r.manifest["chapters"]) == 4


def test_missing_input_emits_error(tmp_path, convert):
    r = convert(tmp_path / "nope.pdf")
    assert r.proc.returncode == 1
    assert r.events[-1]["type"] == "error" and "not found" in r.events[-1]["message"]


def test_stdout_is_json_lines_only(tmp_path, convert):
    r = convert(make_pdf(tmp_path / "in.pdf", TITLES, toc=True))
    # Result() parses every stdout line as JSON; reaching here means no stray output.
    assert len(r.events) == len([ln for ln in r.proc.stdout.splitlines() if ln.strip()])


@pytest.mark.skipif(not shutil.which("tesseract"), reason="tesseract not installed")
def test_ocr_image_only_page(tmp_path, convert):
    # Render text to a bitmap, then embed it as an image-only page.
    src_doc = pymupdf.open()
    page = src_doc.new_page()
    page.insert_textbox(pymupdf.Rect(50, 50, 550, 300), "Scanned paragraph about onboarding checklists and activation.",
                        fontsize=28)
    png = page.get_pixmap(dpi=200).tobytes("png")
    doc = pymupdf.open()
    scan = doc.new_page()
    scan.insert_image(scan.rect, stream=png)
    path = tmp_path / "scan.pdf"
    doc.save(path)
    r = convert(path)
    assert r.proc.returncode == 0, r.proc.stderr
    m = r.manifest
    assert m["converter"]["ocrPages"] == 1
    assert "onboarding" in (r.out / m["chapters"][0]["file"]).read_text().lower()
    off = convert(path, "--ocr", "off", out=tmp_path / "off")
    # Without OCR an image-only book has no text at all, which is a failed conversion.
    assert off.proc.returncode == 1 and off.events[-1]["type"] == "error"


def test_monospaced_listing_is_fenced_with_line_breaks(tmp_path, convert):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Using Git", fontsize=24)
    page.insert_textbox(pymupdf.Rect(72, 130, 540, 200), "Run the following commands to begin working.", fontsize=11)
    for i, line in enumerate(["$ git init", "$ git add README", "$ git commit -m start"]):
        page.insert_text((72, 230 + i * 14), line, fontname="cour", fontsize=10)
    page.insert_textbox(pymupdf.Rect(72, 300, 540, 400), "That is all there is to it for now.", fontsize=11)
    path = tmp_path / "code.pdf"
    doc.save(path)
    r = convert(path)
    text = (r.out / r.manifest["chapters"][0]["file"]).read_text()
    assert "```\n$ git init\n$ git add README\n$ git commit -m start\n```" in text


def test_part_chapter_nesting_is_flattened(tmp_path, convert):
    """Parts are replaced by their chapters; a Part title page with little text is dropped."""
    doc = pymupdf.open()
    toc = []

    def add(title, text_words, level):
        page = doc.new_page()
        page.insert_text((72, 100), title, fontsize=22)
        page.insert_textbox(pymupdf.Rect(72, 130, 540, 760), " ".join("".join(chr(97 + (i * 7 + j * 3 + len(title)) % 26) for j in range(5 + i % 4))
                                          for i in range(text_words)), fontsize=9)
        toc.append([level, title, doc.page_count])

    add("Introduction", 200, 1)
    add("Contents", 20, 1)  # near-empty table of contents: dropped with a warning
    add("Part I", 10, 1)  # title page only
    add("Chapter 1", 200, 2)
    add("Chapter 2", 200, 2)
    add("Part II", 200, 1)  # own text before its first child: merged into Chapter 3
    add("Chapter 3", 200, 2)
    add("Glossary", 200, 1)
    doc.set_toc(toc)
    path = tmp_path / "parts.pdf"
    doc.save(path)
    r = convert(path)
    chapters = r.manifest["chapters"]
    assert [c["title"] for c in chapters] == ["Introduction", "Chapter 1", "Chapter 2", "Chapter 3", "Glossary"]
    assert [c["level"] for c in chapters] == [1, 2, 2, 2, 1]
    assert chapters[3]["pages"] == [6, 7]  # Part II page merged in
    assert any("Contents" in w for w in r.manifest["stats"]["warnings"])


def test_pdf_without_any_text_is_an_error(tmp_path, convert):
    doc = pymupdf.open()
    for _ in range(3):
        doc.new_page()  # image-only/blank pages: nothing to extract
    src = tmp_path / "scan.pdf"
    doc.save(src)
    r = convert(src, "--ocr", "off")
    assert r.proc.returncode == 1
    assert r.events[-1] == {"type": "error", "message": "No text found — scanned PDF? Re-run with OCR (--ocr force) or check the file."}
