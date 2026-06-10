"""Phase 2 Step 1 — PDF text extraction with PyMuPDF (fitz).

Also pulls out embedded images (for Moondream captioning) and converts
detected tables to markdown so tabular data survives chunking.
"""

from dataclasses import dataclass, field

import fitz  # PyMuPDF


@dataclass
class PageContent:
    page_number: int
    text: str
    tables_markdown: list[str] = field(default_factory=list)
    images: list[bytes] = field(default_factory=list)


def extract_pdf(data: bytes) -> list[PageContent]:
    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[PageContent] = []
    for i, page in enumerate(doc):
        content = PageContent(page_number=i + 1, text=page.get_text("text").strip())

        try:
            for table in page.find_tables():
                content.tables_markdown.append(table.to_markdown())
        except Exception:
            pass  # table detection is best-effort

        for img in page.get_images(full=True):
            try:
                content.images.append(doc.extract_image(img[0])["image"])
            except Exception:
                continue

        pages.append(content)
    doc.close()
    return pages
