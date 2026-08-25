"""Durable document-ingestion worker.

Supabase owns the queue state and atomically leases one document at a time.
This loop may therefore run in multiple backend instances without processing
the same queued document concurrently.
"""

import asyncio
import logging

from ..config import get_settings
from ..pipeline.ingest import ingest_document
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)


def claim_next_document(stale_after_seconds: int, max_attempts: int) -> str | None:
    result = get_supabase().rpc(
        "claim_document_ingestion",
        {
            "p_stale_after_seconds": stale_after_seconds,
            "p_max_attempts": max_attempts,
        },
    ).execute()
    data = result.data
    if not data:
        return None
    row = data[0] if isinstance(data, list) else data
    if not isinstance(row, dict) or not row.get("document_id"):
        raise RuntimeError("Document claim function returned an invalid result")
    return str(row["document_id"])


async def run_document_worker() -> None:
    settings = get_settings()
    poll_seconds = max(0.25, settings.document_worker_poll_seconds)
    stale_after_seconds = max(60, settings.document_job_stale_seconds)
    max_attempts = max(1, settings.document_job_max_attempts)
    logger.info("Document ingestion worker started")

    while True:
        try:
            document_id = await asyncio.to_thread(
                claim_next_document,
                stale_after_seconds,
                max_attempts,
            )
            if document_id:
                logger.info("Document worker claimed %s", document_id)
                await asyncio.to_thread(ingest_document, document_id)
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Document worker iteration failed")

        await asyncio.sleep(poll_seconds)
