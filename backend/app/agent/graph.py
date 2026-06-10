"""Phase 4 — Agentic Reasoning and Routing (LangGraph).

decompose → retrieve (hybrid + RRF) → grade G(ci) → route:
  • enough relevant context  → generate (grounded answer with references)
  • G(ci)=0 for all chunks   → escalate (HITL row in chat_requests)
"""

import logging
import re
from typing import TypedDict

from langgraph.graph import END, StateGraph

from ..config import get_settings
from ..services import llm, retrieval
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Strips leftover bracketed citations like [1], [Source 2], [1, page 9].
# Square brackets only — "(4)" in text like "Four (4) copies" must survive.
_CITATION_RE = re.compile(
    r"\s*\[\s*(?:source\s*)?\d+(?:\s*,\s*(?:page|p\.?)\s*\d+)?\s*\]", re.IGNORECASE
)


class AgentState(TypedDict, total=False):
    question: str
    student_id: str | None
    student_email: str | None
    student_name: str | None
    model: str | None   # user-selected variant (None = env default)
    effort: str | None  # reasoning effort: low / medium / high
    intent: str
    sub_queries: list[str]
    candidates: list[dict]
    relevant: list[dict]
    answer: str
    reasoning: str
    sources: list[dict]
    escalated: bool
    request_id: str | None


# ── Intent triage: greetings/small talk skip retrieval & never escalate ─────
def classify(state: AgentState) -> AgentState:
    result = llm.chat_json(
        [
            {
                "role": "system",
                "content": (
                    "Classify a student's chat message for a university assistant.\n"
                    "- 'question': asks for ANY university/academic information "
                    "(admission, enrollment, requirements, policies, fees, "
                    "schedules, offices, courses, etc.), even if mixed with a "
                    "greeting.\n"
                    "- 'chitchat': pure greeting, thanks, small talk, or asking "
                    "about the assistant itself, with no information request.\n"
                    'Reply ONLY with JSON: {"intent": "question"} or '
                    '{"intent": "chitchat"}.'
                ),
            },
            {"role": "user", "content": state["question"]},
        ],
        model=get_settings().grader_model,
    )
    intent = result.get("intent") if isinstance(result, dict) else None
    # when unsure, treat as a real question (safe default)
    return {"intent": intent if intent in ("question", "chitchat") else "question"}


def route_intent(state: AgentState) -> str:
    return "chitchat" if state["intent"] == "chitchat" else "decompose"


def chitchat(state: AgentState) -> AgentState:
    answer, _ = llm.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are ISKOLARChat, the friendly AI assistant of Isabela "
                    "State University students. The student is just greeting or "
                    "chatting — reply warmly and briefly (1-3 sentences) in the "
                    "same language they used (English, Filipino, or Taglish), "
                    "and invite them to ask about university topics like "
                    "admission, enrollment, or school policies. Do not state "
                    "any specific university facts."
                ),
            },
            {"role": "user", "content": state["question"]},
        ],
        model=state.get("model"),
    )
    return {"answer": answer, "reasoning": "", "sources": [], "escalated": False}


# ── Step 0: query decomposition ──────────────────────────────────────────────
def decompose(state: AgentState) -> AgentState:
    result = llm.chat_json(
        [
            {
                "role": "system",
                "content": (
                    "Decompose the user's question into 1-3 standalone search "
                    "queries for a university knowledge base. Reply ONLY with a "
                    'JSON array of strings, e.g. ["query one", "query two"].'
                ),
            },
            {"role": "user", "content": state["question"]},
        ],
        model=get_settings().grader_model,
    )
    queries = [q for q in result if isinstance(q, str)] if isinstance(result, list) else []
    return {"sub_queries": queries[:3] or [state["question"]]}


# ── Phase 3: hybrid retrieval + RRF ──────────────────────────────────────────
def retrieve(state: AgentState) -> AgentState:
    return {"candidates": retrieval.hybrid_search(state["sub_queries"])}


# ── Step 1: relevance grading G(ci) ──────────────────────────────────────────
def grade(state: AgentState) -> AgentState:
    s = get_settings()
    candidates = state["candidates"]
    if not candidates:
        return {"relevant": []}

    listing = "\n\n".join(
        f"[{i}] {c['text'][:600]}" for i, c in enumerate(candidates)
    )
    result = llm.chat_json(
        [
            {
                "role": "system",
                "content": (
                    "You grade retrieved context chunks for relevance to a user "
                    "question. For each chunk, output a relevance score between "
                    "0 and 1 (1 = directly answers the question). Reply ONLY "
                    'with a JSON array of numbers, one per chunk, e.g. [0.9, 0.1].'
                ),
            },
            {
                "role": "user",
                "content": f"Question: {state['question']}\n\nChunks:\n{listing}",
            },
        ],
        model=s.grader_model,
    )

    scores = result if isinstance(result, list) else []
    relevant = []
    for i, c in enumerate(candidates):
        try:
            score = float(scores[i])
        except (IndexError, TypeError, ValueError):
            score = 0.0
        if score >= s.relevance_threshold:  # G(ci) = 1
            relevant.append({**c, "grade_score": score})
    return {"relevant": relevant}


# ── Step 2: routing decision ─────────────────────────────────────────────────
def route(state: AgentState) -> str:
    if len(state["relevant"]) >= get_settings().min_relevant_chunks:
        return "generate"
    return "escalate"


# ── Grounded response generation (DeepSeek R1 or any configured model) ──────
def generate(state: AgentState) -> AgentState:
    context = "\n\n".join(
        f"[Source {i + 1} | {c.get('document_name', 'document')}"
        + (f", page {c['page']}" if c.get("page") else "")
        + f"]\n{c['text']}"
        for i, c in enumerate(state["relevant"])
    )
    answer, reasoning = llm.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are ISKOLARChat, a friendly student assistant of Isabela "
                    "State University — think of yourself as a helpful upperclassman "
                    "(parang ate/kuya sa campus), warm and approachable, never stiff "
                    "or robotic.\n\n"
                    "Style rules:\n"
                    "- Reply in the same language the student used (English, "
                    "Filipino, or Taglish).\n"
                    "- Start with a short, natural one-line response to the "
                    "question — no formal preambles like 'According to the manual'.\n"
                    "- Use short paragraphs and markdown bullet lists; bold the "
                    "key terms. Never cram everything into one long paragraph.\n"
                    "- End with one short, helpful follow-up offer when natural "
                    "(e.g. asking if they want details about a specific item).\n\n"
                    "Content rules (strict):\n"
                    "- Answer using ONLY the provided context. Never invent "
                    "information, offices, fees, or dates.\n"
                    "- Do NOT mention sources, page numbers, document names, or "
                    "bracketed citations like [Source 1] in your reply — the app "
                    "already shows references below your message. Just answer "
                    "naturally, as if you simply know it.\n"
                    "- If the context only partially answers, say plainly which "
                    "part you couldn't find."
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {state['question']}",
            },
        ],
        model=state.get("model"),
        effort=state.get("effort"),
    )
    answer = _CITATION_RE.sub("", answer)
    sources = [
        {
            "document_name": c.get("document_name"),
            "page": c.get("page"),
            "source": c.get("source"),
            "snippet": c["text"][:200],
        }
        for c in state["relevant"]
    ]
    return {"answer": answer, "reasoning": reasoning, "sources": sources, "escalated": False}


# ── Step 3: HITL escalation ──────────────────────────────────────────────────
def escalate(state: AgentState) -> AgentState:
    row = (
        get_supabase()
        .table("chat_requests")
        .insert(
            {
                "student_id": state.get("student_id"),
                "student_email": state.get("student_email"),
                "student_name": state.get("student_name"),
                "question": state["question"],
                "status": "pending",
            }
        )
        .execute()
    ).data
    return {
        "answer": (
            "I couldn't find reliable information in the university knowledge "
            "base to answer this. Your question has been forwarded to the "
            "admin staff — you'll receive a verified answer soon."
        ),
        "reasoning": "",
        "sources": [],
        "escalated": True,
        "request_id": row[0]["id"] if row else None,
    }


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("classify", classify)
    g.add_node("chitchat", chitchat)
    g.add_node("decompose", decompose)
    g.add_node("retrieve", retrieve)
    g.add_node("grade", grade)
    g.add_node("generate", generate)
    g.add_node("escalate", escalate)

    g.set_entry_point("classify")
    g.add_conditional_edges("classify", route_intent, {"chitchat": "chitchat", "decompose": "decompose"})
    g.add_edge("chitchat", END)
    g.add_edge("decompose", "retrieve")
    g.add_edge("retrieve", "grade")
    g.add_conditional_edges("grade", route, {"generate": "generate", "escalate": "escalate"})
    g.add_edge("generate", END)
    g.add_edge("escalate", END)
    return g.compile()


_graph = None


def run_agent(
    question: str,
    student: dict | None = None,
    model: str | None = None,
    effort: str | None = None,
) -> AgentState:
    global _graph
    if _graph is None:
        _graph = build_graph()
    student = student or {}
    return _graph.invoke(
        {
            "question": question,
            "student_id": student.get("id"),
            "student_email": student.get("email"),
            "student_name": student.get("name"),
            "model": model,
            "effort": effort,
        }
    )
