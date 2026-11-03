"""Drop caps, split initials and compound hyphens: unit rules plus an end-to-end PDF with a real drop cap.

Sample text is public domain: Jane Austen, "Pride and Prejudice" (1813) and Sun Tzu,
"The Art of War" (Lionel Giles translation, 1910).
"""

from collections import Counter
from pathlib import Path

import pymupdf

from book_convert.pdf_drop_caps import (book_vocabulary, compound_hyphens, join_split_initials,
                                        repair_drop_caps, restore_compound_hyphens, should_join)

BODY = ("However little known the feelings or views of such a man may be on his first entering a "
        "neighbourhood, this truth is so well fixed in the minds of the surrounding families. " * 2).strip()


def test_drop_cap_letter_rejoins_first_word_and_stray_is_removed():
    md = "## Chapter 1\n\nt is a truth universally acknowledged, that a single man **I** in possession of a good fortune.\n"
    out = repair_drop_caps(md, [("I", "t is a truth universally acknowledged,")], Counter({"it": 5}))
    assert "It is a truth universally acknowledged, that a single man in possession of a good fortune." in out
    assert "**I**" not in out


def test_single_letter_word_stays_separate():
    md = "lady’s imagination is very rapid. **A**\n"
    out = repair_drop_caps(md, [("A", "lady’s imagination is very")], Counter({"lady’s": 4}))
    assert out.startswith("A lady’s imagination is very rapid")


def test_fragment_inside_heading_is_not_matched():
    md = "## The Art of War\n\nhe Art of War is of vital importance to the State. **T**\n"
    out = repair_drop_caps(md, [("T", "he Art of War is of vital")], Counter({"the": 40}))
    assert "## The Art of War\n" in out
    assert "\nThe Art of War is of vital importance to the State." in out


def test_should_join_rules():
    vocab = Counter({"it": 9, "lady’s": 4, "the": 50, "he": 9})
    assert should_join("W", "ar", vocab)               # not a standalone letter
    assert should_join("T", "he", vocab)               # "the" is a word in the book
    assert should_join("I", "t", vocab)                # "it" is a word in the book
    assert not should_join("A", "lady’s", vocab)       # "alady’s" absent, "lady’s" is a word


def test_split_initials_join_only_real_words():
    vocab = Counter({"laying": 4, "waging": 3, "good": 7, "is": 90})
    md = "1. **L** aying Plans\n2. **W** aging War\nHe is **A** good general. Option **B** is best."
    out = join_split_initials(md, vocab)
    assert "**L**aying Plans" in out and "**W**aging War" in out
    assert "**A** good general" in out and "**B** is best" in out


def _drop_cap_pdf(path: Path) -> Path:
    doc = pymupdf.open()
    openings = [("Chapter 1", "I", "t is a truth universally acknowledged,"),
                ("Laying Plans", "T", "he art of war is of vital importance")]
    for title, cap, first in openings:
        page = doc.new_page()
        page.insert_text((200, 120), title, fontsize=21, fontname="tibo")
        page.insert_text((77, 215), cap, fontsize=66, fontname="tibo")
        page.insert_text((153, 170), first, fontsize=15, fontname="tiro")
        page.insert_text((153, 187), "and so the paragraph continues", fontsize=15, fontname="tiro")
        page.insert_textbox(pymupdf.Rect(77, 240, 535, 700), BODY, fontsize=15, fontname="tiro")
    doc.set_toc([[1, "Chapter 1", 1], [1, "Laying Plans", 2]])
    doc.save(path)
    return path


def test_pdf_with_drop_caps_end_to_end(tmp_path, convert):
    res = convert(_drop_cap_pdf(tmp_path / "dropcap.pdf"), "--ocr", "off")
    assert res.proc.returncode == 0, res.proc.stderr
    text = "\n".join(p.read_text() for p in sorted((res.out / "markdown").glob("*.md")))
    assert "It is a truth universally acknowledged" in text
    assert "The art of war is of vital importance" in text
    assert "t is a truth" not in text.replace("It is a truth", "")


def test_compound_hyphen_restoration_rules():
    compounds = {"wellknown": 4, "longterm": 4, "timeto": 4}
    md = "WellKnown authors, a wellknown fact, longterm plans, a timeto-value metric, another day."
    assert restore_compound_hyphens(md, compounds) == (
        "Well-Known authors, a well-known fact, long-term plans, a time-to-value metric, another day.")


def test_compound_detection_never_hyphenates_real_words():
    doc = pymupdf.open()
    page = doc.new_page()
    lines = ["We like long-term thinking and another plan.", "Long-term again, and another one,", "then an-",
             "other split and long-", "term split. Some exam-", "ple text. another"]
    for i, line in enumerate(lines):
        page.insert_text((72, 72 + 18 * i), line, fontsize=11)
    found = compound_hyphens(doc, book_vocabulary(doc))
    assert "longterm" in found
    assert "another" not in found      # real word: printed joined elsewhere
    assert "example" not in found      # hyphenation, "ple" is not a word


def test_inline_cap_on_the_same_line_closes_the_gap():
    # A narrow cap can be extracted on the paragraph's own line: "I t is a truth".
    out = repair_drop_caps("I t is a truth universally acknowledged.", [("I", "t is a truth universally")], Counter({"it": 3}))
    assert out == "It is a truth universally acknowledged."
    # a real one-letter word stays separate
    out = repair_drop_caps("A lady’s imagination is very rapid.", [("A", "lady’s imagination is very")], Counter({"lady’s": 4}))
    assert out == "A lady’s imagination is very rapid."
