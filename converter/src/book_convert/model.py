"""Plain data passed from the format-specific extractors to the writer."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Chapter:
    title: str
    level: int
    body: str  # Markdown without the leading "# title" heading
    pages: tuple[int, int] | None = None  # inclusive 1-based, PDF only


@dataclass
class Extracted:
    engine: str
    title: str
    authors: list[str]
    chapters: list[Chapter]
    language: str | None = None
    source_pages: int | None = None
    ocr_pages: int = 0
    extra: dict = field(default_factory=dict)
