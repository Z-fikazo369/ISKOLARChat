"""Phase 2 — Document Ingestion Pipeline orchestrator.

PDF → PyMuPDF extraction → Moondream captions → semantic chunks
→ Cohere embeddings → Qdrant upsert → BM25 rebuild → status update.
"""

import logging

from ..services import bm25, embeddings, vectorstore
from ..services.supabase_client import get_supabase
from . import caption, chunk, extract

logger = logging.getLogger(__name__)

BUCKET = "documents"


def ingest_document(document_id: str) -> None:
    """Runs as a FastAPI background task; reports status via the documents row."""
    sb = get_supabase()
    try:
        row = (
            sb.table("documents").select("*").eq("id", document_id).single().execute()
        ).data
        file_bytes = sb.storage.from_(BUCKET).download(row["file_path"])

        pages = extract.extract_pdf(file_bytes)

        chunks: list[dict] = []
        for page in pages:
            parts = [page.text] if page.text else []
            parts.extend(f"[Table]\n{t}" for t in page.tables_markdown)
            for img in page.images:
                cap = caption.caption_image(img)
                if cap:
                    parts.append(f"[Image description] {cap}")

            for piece in chunk.chunk_text("\n\n".join(parts)):
                chunks.append(
                    {
                        "text": piece,
                        "document_id": document_id,
                        "document_name": row["name"],
                        "source": "document",
                        "page": page.page_number,
                        "chunk_index": len(chunks),
                    }
                )

        if not chunks:
            raise ValueError("No extractable text found in the PDF.")

        vectorstore.ensure_collection()
        vectorstore.upsert_chunks(chunks, embeddings.embed_documents([c["text"] for c in chunks]))
        bm25.rebuild_index()

        sb.table("documents").update(
            {"status": "ready", "chunk_count": len(chunks), "error": None}
        ).eq("id", document_id).execute()
        logger.info("Ingested %s (%d chunks)", row["name"], len(chunks))

    except Exception as exc:
        logger.exception("Ingestion failed for document %s", document_id)
        sb.table("documents").update(
            {"status": "failed", "error": str(exc)[:500]}
        ).eq("id", document_id).execute()


def ingest_hitl_answer(request_id: str, question: str, answer: str) -> None:
    """Phase 1 Step 4 — Knowledge Loop: re-ingest an admin-verified answer."""
    text = f"Question: {question}\nVerified answer: {answer}"
    vectorstore.ensure_collection()
    vectorstore.upsert_chunks(
        [
            {
                "text": text,
                "document_id": f"hitl_{request_id}",
                "document_name": "Admin-verified answer",
                "source": "hitl_answer",
                "page": None,
                "chunk_index": 0,
            }
        ],
        embeddings.embed_documents([text]),
    )
    bm25.rebuild_index()
