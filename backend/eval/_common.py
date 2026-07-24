"""Shared helpers for the evaluation harness.

Everything here is eval-only. The single side effect the agentic graph
normally has (inserting escalations into the chat_requests table) is
patched out below, so evaluation runs are read-only against Supabase —
no rows are ever written to the production database.
"""

import csv
import json
import os
import sys
import time
from pathlib import Path

EVAL_DIR = Path(__file__).parent
BACKEND_DIR = EVAL_DIR.parent
TESTSET = EVAL_DIR / "testset.csv"

# Make `app.*` importable and ensure .env resolves, no matter where the
# script is launched from.
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Windows consoles default to cp1252, which can't print "₱", "→", etc. —
# make eval output crash-proof regardless of what the testset contains.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _shim_removed_langchain_modules() -> None:
    """ragas 0.4.x unconditionally imports VertexAI classes that
    langchain-community 0.4.x removed. ragas only uses them for isinstance
    checks (our judge is ChatOpenAI), so register dummy stand-ins for the
    missing modules/attributes. This touches sys.modules of the eval process
    only — site-packages stay pristine."""
    import importlib
    import types

    for module_name, attr in [
        ("langchain_community.chat_models.vertexai", "ChatVertexAI"),
        ("langchain_community.llms", "VertexAI"),
    ]:
        try:
            mod = importlib.import_module(module_name)
        except Exception:
            mod = types.ModuleType(module_name)
            sys.modules[module_name] = mod
        if not hasattr(mod, attr):
            setattr(mod, attr, type(attr, (), {}))


_shim_removed_langchain_modules()

from app.agent import graph as _graph_module  # noqa: E402
from app.agent.baseline import run_baseline  # noqa: E402  (re-exported)


def _eval_escalate(state: dict) -> dict:
    """Drop-in replacement for graph.escalate: identical output, but does
    NOT insert a row into chat_requests."""
    return {
        "answer": (
            "I couldn't find reliable information in the university knowledge "
            "base to answer this. Your question has been forwarded to the "
            "admin staff — you'll receive a verified answer soon."
        ),
        "reasoning": "",
        "sources": [],
        "escalated": True,
        "request_id": None,
    }


# Patch BEFORE the lazy graph is compiled (run_agent builds it on first call,
# looking the node function up from the module globals).
_graph_module.escalate = _eval_escalate
assert _graph_module._graph is None, (
    "Agent graph was already compiled before the eval patch was applied — "
    "run the eval scripts in a fresh process."
)

run_agent = _graph_module.run_agent


# OpenRouter reserves the model's FULL completion budget (deepseek-v4-flash =
# 65,536 tokens) against your balance on every call when max_tokens is unset,
# which 402s on low balances even though the actual answer is tiny. Cap it for
# eval only — answers and judgments are short, so this never truncates. This
# patches the in-process OpenAI client used during collection; the app's
# services/llm.py on disk is NOT modified.
def _cap_eval_max_tokens(cap: int = 4096, retries: int = 8) -> None:
    import time

    from openai import APIStatusError, APITimeoutError, RateLimitError

    from app.services import llm as _llm

    client = _llm._client()
    _create = client.chat.completions.create
    if getattr(_create, "_eval_capped", False):
        return

    def capped(*args, **kwargs):
        kwargs.setdefault("max_tokens", cap)
        delay = 8.0
        for attempt in range(retries):
            try:
                return _create(*args, **kwargs)
            except (RateLimitError, APITimeoutError, APIStatusError) as exc:
                # free OpenRouter providers throttle hard; honor Retry-After.
                status = getattr(exc, "status_code", None)
                if status not in (None, 429, 500, 502, 503) or attempt == retries - 1:
                    raise
                wait = delay
                try:
                    ra = exc.response.headers.get("Retry-After")  # type: ignore[attr-defined]
                    if ra:
                        wait = max(wait, float(ra))
                except Exception:
                    pass
                time.sleep(min(wait, 60))
                delay = min(delay * 1.6, 60)

    capped._eval_capped = True
    client.chat.completions.create = capped


_cap_eval_max_tokens()


def run_agentic(question: str) -> dict:
    """Single-turn agentic run (no history — RAGAS testsets are single-turn).
    Returns the full final state, including the trace fields used by the
    agent-metrics eval (intent, sub_queries, standalone_question, relevant)."""
    return run_agent(question)


def load_testset(required: tuple[str, ...] = ("question", "ground_truth")) -> list[dict]:
    if not TESTSET.exists():
        sys.exit(
            f"Missing {TESTSET}.\n"
            "Create it with at least the columns: question,ground_truth\n"
            "(see testset.sample.csv for the format)"
        )
    with open(TESTSET, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit("testset.csv is empty.")
    missing = [c for c in required if c not in rows[0]]
    if missing:
        sys.exit(f"testset.csv is missing required column(s): {', '.join(missing)}")
    return rows


def full_contexts(result: dict) -> list[str]:
    """Full chunk texts (not truncated snippets) — RAGAS must judge against
    the same context the generator actually saw."""
    return [c["text"] for c in result.get("relevant") or []] or [""]


def collect(system: str, delay: float = 1.0) -> list[dict]:
    """Run every testset question through one system; cache to JSON so the
    (slow, paid) collection step never has to repeat for re-scoring."""
    cache = EVAL_DIR / f"collected_{system}.json"
    rows = []
    runner = run_agentic if system == "agentic" else run_baseline
    testset = load_testset()
    for i, row in enumerate(testset, start=1):
        result = runner(row["question"])
        rows.append(
            {
                **row,
                "answer": result.get("answer", ""),
                "contexts": full_contexts(result),
                "escalated": bool(result.get("escalated")),
                "intent": result.get("intent", ""),
                "standalone_question": result.get("standalone_question", ""),
                "sub_queries": result.get("sub_queries", []),
            }
        )
        print(
            f"[{system} {i}/{len(testset)}] "
            f"{'ESCALATED' if rows[-1]['escalated'] else 'answered'}  "
            f"{row['question'][:60]}"
        )
        time.sleep(delay)  # be kind to trial-tier API rate limits
    cache.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Saved raw collection to {cache}")
    return rows


def load_collected(system: str) -> list[dict] | None:
    cache = EVAL_DIR / f"collected_{system}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    return None


def build_judge():
    """RAGAS needs a judge LLM + embeddings. We reuse the project's own
    OpenRouter (DeepSeek) endpoint and Cohere embeddings so no extra
    accounts/keys are needed."""
    try:
        from langchain_core.embeddings import Embeddings
        from langchain_openai import ChatOpenAI
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
    except ImportError:
        sys.exit(
            "Eval dependencies missing. Run:\n"
            "  pip install -r eval/requirements-eval.txt"
        )

    from app.config import get_settings
    from app.services import embeddings as emb

    s = get_settings()
    judge_llm = LangchainLLMWrapper(
        ChatOpenAI(
            base_url=s.llm_base_url,
            api_key=s.llm_api_key,
            model=s.llm_model,
            temperature=0.0,
            # Cap reservation (avoids 402s) and retry the upstream 429s
            # OpenRouter occasionally returns; judgments are short.
            max_tokens=8192,
            max_retries=5,
            timeout=120,
        )
    )

    class CohereEvalEmbeddings(Embeddings):
        def embed_documents(self, texts):
            return emb.embed_documents(list(texts))

        def embed_query(self, text):
            return emb.embed_query(text)

    return judge_llm, LangchainEmbeddingsWrapper(CohereEvalEmbeddings())
