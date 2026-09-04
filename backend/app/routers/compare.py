"""Retrieval-transparency endpoint — Naive RAG vs. Agentic RAG (Objective 2 demo).

This router exists ONLY so the standalone /compare page can show professors the
two retrieval strategies side by side on any question. It is additive and fully
isolated from the live chat flow:

  • The naive side reuses ``app/agent/baseline.run_baseline`` (pure semantic
    top-K → generate), which nothing in the live app imports.
  • The agentic side replicates the pipeline by calling the graph's node
    functions directly (classify → decompose → retrieve → grade → route →
    generate) INSTEAD of ``run_agent``. So the production LangGraph singleton is
    never built or invoked here, and the one DB write the agent normally makes —
    the HITL escalation insert into ``chat_requests`` — is NEVER triggered.
    Comparison runs are therefore read-only against Supabase, exactly like the
    eval harness.

This router is disabled by default because it returns full retrieval traces
and performs several paid provider calls. When enabled, admin access is still
required (each run fires two full LLM pipelines — naive + agentic — so
students must not be able to trigger it on demand).
"""

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..agent import graph as agent
from ..agent.baseline import run_baseline
from ..config import get_settings
from ..deps.auth import require_admin
from ..deps.ratelimit import rate_limit

router = APIRouter(prefix="/api", tags=["compare"])


class CompareRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)


def _round(value) -> float | None:
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def _chunk_view(chunks: list[dict]) -> list[dict]:
    """Normalize chunks into a UI-friendly shape, exposing whichever retrieval
    scores are present so the comparison stays transparent:
      • semantic_score — Qdrant cosine similarity (naive top-K)
      • rrf_score      — Reciprocal Rank Fusion score (agentic candidates)
      • grade_score    — LLM relevance grade G(ci) (agentic graded chunks)
    """
    out = []
    for i, c in enumerate(chunks, start=1):
        out.append(
            {
                "rank": i,
                "id": c.get("id"),  # lets the UI tell which chunks the two systems share
                "document_name": c.get("document_name"),
                "page": c.get("page"),
                "source": c.get("source"),
                "text": c.get("text", ""),
                "semantic_score": _round(c.get("score")),
                "rrf_score": _round(c.get("rrf_score")),
                "grade_score": _round(c.get("grade_score")),
            }
        )
    return out


def _run_naive(question: str) -> dict:
    """Standard RAG: embed → semantic top-K → generate."""
    result = run_baseline(question)
    return {
        "answer": result.get("answer", ""),
        "chunks": _chunk_view(result.get("relevant") or []),
    }


def _run_agentic(question: str) -> dict:
    """Agentic pipeline, run node-by-node and READ-ONLY (no escalate DB write,
    no live graph touched)."""
    state: dict = {"question": question, "history": []}
    state.update(agent.classify(state))

    # Pure greeting / small talk: the agent doesn't retrieve at all.
    if state.get("intent") == "chitchat":
        state.update(agent.chitchat(state))
        return {
            "intent": "chitchat",
            "standalone_question": state.get("standalone_question", question),
            "sub_queries": [],
            "candidates": [],
            "relevant": [],
            "answer": state.get("answer", ""),
            "escalated": False,
        }

    state.update(agent.decompose(state))   # 1-3 sub-queries
    state.update(agent.retrieve(state))    # candidates: hybrid + RRF (rrf_score)
    state.update(agent.grade(state))       # relevant: graded >= threshold (grade_score)

    if agent.route(state) == "escalate":
        # In production this writes a chat_requests row; here we only REPORT it.
        answer = (
            "_(In the live system this question would be escalated to a human "
            "admin — no retrieved context passed the relevance grader, so no "
            "answer is generated. Nothing is written to the database during "
            "this comparison.)_"
        )
        escalated = True
    else:
        state.update(agent.generate(state))
        answer = state.get("answer", "")
        escalated = False

    return {
        "intent": state.get("intent", "question"),
        "standalone_question": state.get("standalone_question", question),
        "sub_queries": state.get("sub_queries", []),
        "candidates": _chunk_view(state.get("candidates") or []),
        "relevant": _chunk_view(state.get("relevant") or []),
        "answer": answer,
        "escalated": escalated,
    }


# Each request fires several paid LLM/embedding calls, so enabled deployments
# require an admin account (server-side — the React route gate only mirrors
# this) and rate-limit each request.
@router.post("/compare", dependencies=[Depends(rate_limit("compare", 5))])
def compare(body: CompareRequest, _admin: dict = Depends(require_admin)) -> dict:
    """Run both systems on the same question (concurrently) and return their
    retrieval traces + answers for side-by-side display."""
    question = body.question.strip()
    s = get_settings()

    # Both systems hit the same external APIs and are independent — run them in
    # parallel so the demo feels snappy.
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            naive_fut = pool.submit(_run_naive, question)
            agentic_fut = pool.submit(_run_agentic, question)
            naive = naive_fut.result()
            agentic = agentic_fut.result()
    except Exception as exc:
        raise HTTPException(
            503, "AI comparison capacity is temporarily unavailable. Please retry shortly."
        ) from exc

    return {
        "question": question,
        "naive": naive,
        "agentic": agentic,
        # Shared experiment parameters — both systems use these, so they're the
        # controlled variables for the comparison (paste-ready for methodology).
        "settings": {
            "final_top_k": s.final_top_k,
            "search_top_n": s.search_top_n,
            "rrf_k": s.rrf_k,
            "relevance_threshold": s.relevance_threshold,
            "embed_model": s.embed_model,
            "llm_model": s.llm_model,
        },
    }
