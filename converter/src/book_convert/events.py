"""Progress/warning/error reporting.

Machine events (ConverterEvent from packages/shared/src/library-types.ts) go to a
dedicated stream as JSON lines when --json is set; human-readable logs always go to
stderr so stdout stays parseable.
"""

from __future__ import annotations

import json
import sys
from typing import IO, Literal

Stage = Literal["open", "extract", "ocr", "split", "write"]


class Emitter:
    def __init__(self, json_stream: IO[str] | None = None) -> None:
        self._json = json_stream
        self.warnings: list[str] = []

    def _send(self, event: dict) -> None:
        if self._json is not None:
            self._json.write(json.dumps(event, ensure_ascii=False) + "\n")
            self._json.flush()

    def progress(self, stage: Stage, current: int | None = None, total: int | None = None,
                 message: str | None = None) -> None:
        event: dict = {"type": "progress", "stage": stage}
        if current is not None:
            event["current"] = current
        if total is not None:
            event["total"] = total
        if message:
            event["message"] = message
        self._send(event)
        parts = [stage] + ([f"{current}/{total}"] if current is not None and total else []) + ([message] if message else [])
        print("[book-convert] " + " ".join(parts), file=sys.stderr, flush=True)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        self._send({"type": "warning", "message": message})
        print(f"[book-convert] warning: {message}", file=sys.stderr, flush=True)

    def done(self, manifest: str) -> None:
        self._send({"type": "done", "manifest": manifest})

    def error(self, message: str) -> None:
        self._send({"type": "error", "message": message})
        print(f"[book-convert] error: {message}", file=sys.stderr, flush=True)
