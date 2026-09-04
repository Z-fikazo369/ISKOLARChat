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
    """Process a document claimed by the durable ingestion worker."""
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
        vectors = embeddings.embed_documents([c["text"] for c in chunks])

        # The admin may have deleted the document while we were extracting/
        # embedding — indexing now would leave orphaned chunks with no owning
        # row, permanently answering questions from a "deleted" document.
        # 'deleting' is the tombstone the delete endpoint sets before removing
        # anything, so only proceed while this row is still ours.
        state = (
            sb.table("documents").select("id, status").eq("id", document_id).maybe_single().execute()
        )
        if not state or not state.data or state.data.get("status") != "processing":
            logger.info("Document %s was deleted mid-ingest; skipping indexing", document_id)
            return

        # Drop any chunks from a previous ingest run first, so a re-ingest of a
        # shorter document doesn't leave stale trailing chunks behind.
        vectorstore.delete_document_chunks(document_id)
        vectorstore.upsert_chunks(chunks, vectors)

        # The delete endpoint removes Qdrant chunks AFTER flipping status to
        # 'deleting', so re-checking that we still own the row AFTER the
        # upsert closes the race in both orderings: if the delete began before
        # this check it has removed (or will remove) our fresh chunks itself;
        # if it begins after, its own chunk-delete removes them. Either way
        # chunks never outlive the row that owns them.
        still_processing = (
            sb.table("documents").select("id, status").eq("id", document_id).maybe_single().execute()
        )
        if not still_processing or not still_processing.data or still_processing.data.get("status") != "processing":
            logger.info(
                "Document %s was deleted during indexing; removing just-upserted chunks",
                document_id,
            )
            vectorstore.delete_document_chunks(document_id)
            return

        bm25.rebuild_and_publish()

        sb.table("documents").update(
            {
                "status": "ready",
                "chunk_count": len(chunks),
                "error": None,
                "processing_started_at": None,
            }
        ).eq("id", document_id).execute()
        logger.info("Ingested %s (%d chunks)", row["name"], len(chunks))

    except Exception as exc:
        logger.exception("Ingestion failed for document %s", document_id)
        try:
            sb.table("documents").update(
                {
                    "status": "failed",
                    "error": str(exc)[:500],
                    "processing_started_at": None,
                }
            ).eq("id", document_id).execute()
        except Exception:
            # If Supabase itself is the failing dependency, don't let the
            # status update raise inside the background task too.
            logger.exception("Could not mark document %s as failed", document_id)


def ingest_hitl_answer(request_id: str, question: str, answer: str) -> None:
    """Phase 1 Step 4 — Knowledge Loop: re-ingest an admin-verified answer."""
    text = f"Question: {question}\nVerified answer: {answer}"
    vectorstore.ensure_collection()
    # Re-resolving (e.g. fixing a typo in the answer) must replace the old
    # chunk, not add a second one alongside it.
    vectorstore.delete_document_chunks(f"hitl_{request_id}")
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
    bm25.rebuild_and_publish()
