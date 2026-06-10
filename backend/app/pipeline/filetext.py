"""Text extraction for student-attached files (chat uploads).

Unlike the admin ingestion pipeline, these files are NOT added to the
knowledge base — the text is used only as context for one question.
"""

import io

import fitz  # PyMuPDF
from docx import Document

MAX_WORDS = 8000  # keep the prompt within a sane context size


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        doc = fitz.open(stream=data, filetype="pdf")
        text = "\n\n".join(page.get_text("text") for page in doc)
        doc.close()
    elif name.endswith(".docx"):
        docx = Document(io.BytesIO(data))
        parts = [p.text for p in docx.paragraphs if p.text.strip()]
        for table in docx.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text.strip() for cell in row.cells))
        text = "\n\n".join(parts)
    elif name.endswith(".txt"):
        text = data.decode("utf-8", errors="replace")
    else:
        raise ValueError(
            "Unsupported file type. Please attach a PDF, DOCX, or TXT file "
            "(old .doc files are not supported — save as .docx)."
        )

    words = text.split()
    if not words:
        raise ValueError(
            "No readable text found in the file. If it's a scanned document, "
            "the pages are images and can't be read yet."
        )
    truncated = len(words) > MAX_WORDS
    text = " ".join(words[:MAX_WORDS])
    if truncated:
        text += "\n\n[Document truncated — only the first part is shown.]"
    return text
