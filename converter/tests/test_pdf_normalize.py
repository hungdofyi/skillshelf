"""Chapter normalization: fake headings, page-split paragraphs, footnotes, emphasis, dividers, titles.

Sample text is public domain: Jane Austen, "Pride and Prejudice" (1813) and Sun Tzu,
"The Art of War" (Lionel Giles translation, 1910).
"""

from collections import Counter

from book_convert.pdf_drop_caps import repair_drop_caps
from book_convert.pdf_normalize import (demote_lowercase_headings, merge_broken_paragraphs,
                                        normalize_chapter, superscript_footnotes)
from book_convert.textclean import with_title_heading


def test_page_split_sentence_and_fake_heading_are_rejoined():
    md = "a single man in possession of a good fortune, must be in\n\n#### want of a wife.\n\nHowever little known the feelings."
    assert normalize_chapter(md) == (
        "a single man in possession of a good fortune, must be in want of a wife.\n\nHowever little known the feelings.")


def test_list_item_continues_after_page_break():
    md = "1. **Laying plans.** The art of war is governed by five constant factors,<sup>3</sup> to be\n\ntaken into account in one's deliberations."
    assert normalize_chapter(md) == (
        "1. **Laying plans.** The art of war is governed by five constant factors,³ to be taken into account in one's deliberations.")


def test_real_paragraphs_and_headings_are_untouched():
    md = "## Laying Plans\n\nThe first paragraph ends here.\n\nthe next one is lowercase but follows a full stop.\n\n## next steps"
    out = merge_broken_paragraphs(demote_lowercase_headings(md))
    assert "## Laying Plans" in out
    assert "ends here.\n\nthe next one" in out          # terminal punctuation: keep the break
    assert out.endswith("follows a full stop. next steps") is False


def test_code_blocks_and_tables_are_left_alone():
    md = "Run this command\n\n```\n# not a heading\nfoo,\n\nbar\n```\n\n| a | b |\n|---|---|\n\nand then"
    assert normalize_chapter(md) == md


def test_superscripts():
    assert superscript_footnotes("says Sun Tzu,<sup>2</sup> it is") == "says Sun Tzu,² it is"
    assert superscript_footnotes("x <sup>12</sup> y <u>under</u>") == "x¹² y under"


def test_attribution_heading_with_bold_footnote_becomes_clean_line():
    md = "### - Sun Tzu,** <sup>**23**</sup> **The Art of War"
    assert normalize_chapter(md) == "*— Sun Tzu,²³ The Art of War*"


def test_split_bold_runs_and_bold_punctuation():
    assert normalize_chapter("**Body** **_:_**") == "**Body:**"
    assert normalize_chapter("**Subject** **_:_** A note on strategy") == "**Subject:** A note on strategy"
    assert normalize_chapter("**First** **Second** run") == "**First Second** run"
    assert normalize_chapter("A **bold** and **another** run") == "A **bold** and **another** run"


def test_loose_label_colon_joins_bold_label():
    assert normalize_chapter("**Subject** : a personal hello") == "**Subject:** a personal hello"
    assert normalize_chapter("**Body** :") == "**Body:**"
    assert normalize_chapter("Ratio is 3 : 1 here") == "Ratio is 3 : 1 here"


def test_labelled_rule_becomes_canonical_divider():
    for md in ("**-------------** CHAPTER 13 **-------------**", "### ------------- CHAPTER 9 -------------"):
        assert normalize_chapter(md) == "—— CHAPTER 13 ——".replace("13", md.split("CHAPTER ")[1].split(" ")[0])
    # a real attribution still works, and plain prose with dashes is untouched
    assert normalize_chapter("### - Jane Austen, Author") == "*— Jane Austen, Author*"
    assert normalize_chapter("Costs went up -- a lot -- this year") == "Costs went up -- a lot -- this year"


def test_book_title_block_is_kept_instead_of_a_duplicate_h1():
    body = "—— CHAPTER 1 ——\n\n## Laying Plans\n\nText."
    out = with_title_heading("Chapter 1: Laying Plans", body)
    assert out == "—— CHAPTER 1 ——\n\n# Laying Plans\n\nText.\n"
    assert out.count("\n# ") + out.startswith("# ") == 1
    # no matching heading near the top: the TOC title is added
    assert with_title_heading("Chapter 2: Waging War", "## The cost of war\n\nText").startswith("# Chapter 2: Waging War\n")


def test_title_stays_the_only_h1():
    out = with_title_heading("Chapter 3: Attack by Stratagem",
                             "—— CHAPTER 3 ——\n\n# Attack by Stratagem\n\n### Why\n\n# Supreme Excellence\n\n## Detail")
    assert [l for l in out.split("\n") if l.startswith("# ")] == ["# Attack by Stratagem"]
    assert "#### Why" in out and "## Supreme Excellence" in out and "### Detail" in out


def test_drop_cap_emitted_twice_is_fully_removed():
    md = "## Waging War\n\n# I\n\nn the operations of war, where there are in the field, **I** a thousand swift chariots."
    out = repair_drop_caps(md, [("I", "n the operations of war,")], Counter({"in": 50}))
    assert "# I\n" not in out and "**I**" not in out
    assert "In the operations of war, where there are in the field, a thousand swift chariots." in out
