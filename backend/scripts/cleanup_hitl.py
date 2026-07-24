"""One-off cleanup: remove orphaned admin-verified (HITL) answer chunks from
Qdrant — i.e. answers whose chat_requests row was already deleted, so the
system keeps 'remembering' a question that no longer exists.

Run from the backend dir:  python -m scripts.cleanup_hitl
Add --apply to actually delete (default is a dry run that only lists them).
"""

import sys

from app.services import bm25, vectorstore
from app.services.supabase_client import get_supabase


def main() -> None:
    apply = "--apply" in sys.argv

    chunks = vectorstore.scroll_all_chunks()
    hitl = [c for c in chunks if c.get("source") == "hitl_answer"]
    print(f"Found {len(hitl)} admin-verified answer chunk(s) in Qdrant.\n")

    sb = get_supabase()
    orphans: list[str] = []  # document_ids to delete

    for c in hitl:
        doc_id = c.get("document_id", "")           # "hitl_<request_id>"
        request_id = doc_id.removeprefix("hitl_")
        row = (
            sb.table("chat_requests").select("id").eq("id", request_id).maybe_single().execute()
        )
        alive = bool(row and row.data)
        snippet = (c.get("text", "") or "").replace("\n", " ")[:90]
        status = "KEEP (query still exists)" if alive else "ORPHAN -> delete"
        print(f"[{status}] {doc_id}\n    {snippet}\n")
        if not alive:
            orphans.append(doc_id)

    if not orphans:
        print("No orphaned chunks. Nothing to clean.")
        return

    if not apply:
        print(f"\nDRY RUN: {len(orphans)} orphan(s) would be deleted. "
              "Re-run with --apply to delete them.")
        return

    for doc_id in orphans:
        vectorstore.delete_document_chunks(doc_id)
        print(f"Deleted {doc_id}")
    bm25.rebuild_index()
    print(f"\nDone. Removed {len(orphans)} orphaned answer(s) and rebuilt BM25.")


if __name__ == "__main__":
    main()
