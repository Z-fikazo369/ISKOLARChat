"""Phase 2 Step 3 — Semantic chunking with overlap.

Splits on paragraph boundaries first, then packs paragraphs into chunks of
~CHUNK_SIZE_WORDS with CHUNK_OVERLAP_WORDS of trailing context carried into
the next chunk, preserving continuity across segment borders.
"""

import re

from ..config import get_settings


def _split_long(words: list[str], size: int, overlap: int) -> list[str]:
    step = max(size - overlap, 1)
    pieces: list[str] = []
    i = 0
    while True:
        pieces.append(" ".join(words[i : i + size]))
        # Stop once this window reaches the end of the text. A fixed
        # range(0, len(words), step) could emit a final window that was
        # entirely a duplicate of the previous chunk's overlap tail.
        if i + size >= len(words):
            break
        i += step
    return pieces


def chunk_text(text: str) -> list[str]:
    s = get_settings()
    size, overlap = s.chunk_size_words, s.chunk_overlap_words
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    chunks: list[str] = []
    current: list[str] = []  # words accumulated for the chunk being built

    def flush() -> None:
        nonlocal current
        if current:
            chunks.append(" ".join(current))
            current = current[-overlap:]  # overlap carried into the next chunk

    for para in paragraphs:
        words = para.split()
        if len(words) > size:
            flush()
            pieces = _split_long(words, size, overlap)
            chunks.extend(pieces[:-1])
            current = pieces[-1].split()
            continue
        if len(current) + len(words) > size:
            flush()
        current.extend(words)

    if current:
        chunks.append(" ".join(current))
    # Drop tiny fragments — but never ALL of them: a short page (e.g. a
    # one-line memo with a deadline) must still produce a searchable chunk.
    kept = [c for c in chunks if len(c.split()) >= 20]
    return kept or chunks
