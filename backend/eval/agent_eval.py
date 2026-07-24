"""Objective 4 — agent-specific RAGAS metrics for the Agentic RAG model.

  4.1 Goal Accuracy   → ragas AgentGoalAccuracyWithReference
  4.2 F1-Score        → ragas TopicAdherenceScore(mode="f1")
  4.3 Adherence       → ragas TopicAdherenceScore precision + recall

Each testset question is run through the agent; the resulting trajectory
(question → retrieval tool call with the agent's sub-queries → grounded
answer) is rebuilt as a RAGAS multi-turn sample and judged by the LLM.

Optional testset.csv columns used here (fallbacks in parentheses):
  reference         expected outcome of the interaction (ground_truth)
  reference_topics  semicolon-separated allowed topics (default ISU list)

Usage (from the backend/ folder, venv active):
  pip install -r eval/requirements-eval.txt   # needs ragas>=0.2.6
  python eval/agent_eval.py
  python eval/agent_eval.py --recollect       # ignore cached agent runs

Output: eval/results_agent_metrics.csv (+ summary printed)
No Supabase rows are written (HITL insert patched out in _common.py).
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import EVAL_DIR, build_judge, collect, load_collected  # noqa: E402

# Default allowed-topic list for Topic Adherence when the testset doesn't
# provide a reference_topics column.
DEFAULT_TOPICS = [
    "university admission and enrollment",
    "scholarships and financial assistance",
    "academic policies and grading",
    "student services, campus offices, and facilities",
    "school fees and requirements",
    "student organizations, activities, and campus events",
    "student rights, welfare, and code of conduct",
]


def build_samples(rows: list[dict]):
    try:
        from ragas.dataset_schema import MultiTurnSample
        from ragas.messages import AIMessage, HumanMessage, ToolCall, ToolMessage
    except ImportError:
        sys.exit(
            "ragas>=0.2.6 is required for agent metrics. Run:\n"
            "  pip install -r eval/requirements-eval.txt"
        )

    samples = []
    for r in rows:
        topics = [
            t.strip() for t in (r.get("reference_topics") or "").split(";") if t.strip()
        ] or DEFAULT_TOPICS
        sub_queries = r.get("sub_queries") or [r["question"]]
        n_ctx = len([c for c in r.get("contexts", []) if c])

        # Rebuild the agent trajectory as a RAGAS multi-turn conversation:
        # the agent decided to search (tool call with its sub-queries),
        # received context, then answered (or escalated to a human).
        convo = [
            HumanMessage(content=r["question"]),
            AIMessage(
                content="",
                tool_calls=[
                    ToolCall(
                        name="search_knowledge_base",
                        args={"queries": sub_queries},
                    )
                ],
            ),
            ToolMessage(content=f"Retrieved {n_ctx} graded context chunk(s)."),
            AIMessage(content=r["answer"]),
        ]
        samples.append(
            (
                r["question"],
                r["escalated"],
                MultiTurnSample(
                    user_input=convo,
                    reference=r.get("reference") or r["ground_truth"],
                    reference_topics=topics,
                ),
            )
        )
    return samples


async def run_metrics(samples, judge_llm) -> list[dict]:
    from ragas.metrics import AgentGoalAccuracyWithReference, TopicAdherenceScore

    goal = AgentGoalAccuracyWithReference(llm=judge_llm)
    adherence = {
        "topic_adherence_precision": TopicAdherenceScore(llm=judge_llm, mode="precision"),
        "topic_adherence_recall": TopicAdherenceScore(llm=judge_llm, mode="recall"),
        "topic_adherence_f1": TopicAdherenceScore(llm=judge_llm, mode="f1"),
    }

    results = []
    for i, (question, escalated, sample) in enumerate(samples, start=1):
        row = {"question": question, "escalated": escalated}
        try:
            row["goal_accuracy"] = float(await goal.multi_turn_ascore(sample))
        except Exception as exc:  # judge hiccup — record, don't abort the run
            print(f"  ! goal_accuracy failed on Q{i}: {exc}")
            row["goal_accuracy"] = None
        for name, metric in adherence.items():
            try:
                row[name] = float(await metric.multi_turn_ascore(sample))
            except Exception as exc:
                print(f"  ! {name} failed on Q{i}: {exc}")
                row[name] = None
        results.append(row)
        print(
            f"[{i}/{len(samples)}] goal={row['goal_accuracy']} "
            f"f1={row['topic_adherence_f1']}  {question[:55]}"
        )
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--recollect", action="store_true", help="ignore cached agent runs")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between API calls")
    args = ap.parse_args()

    rows = None if args.recollect else load_collected("agentic")
    if rows is None:
        print("=== Collecting agent runs ===")
        rows = collect("agentic", delay=args.delay)
    else:
        print(f"Using cached eval/collected_agentic.json ({len(rows)} rows) — "
              "pass --recollect to redo")

    judge_llm, _ = build_judge()
    samples = build_samples(rows)
    results = asyncio.run(run_metrics(samples, judge_llm))

    import pandas as pd

    df = pd.DataFrame(results)
    out = EVAL_DIR / "results_agent_metrics.csv"
    df.to_csv(out, index=False)

    print("\n=== Agent metrics (means) ===")
    for col in ["goal_accuracy", "topic_adherence_precision",
                "topic_adherence_recall", "topic_adherence_f1"]:
        scored = df[col].dropna()
        print(f"{col:28s} {scored.mean():.4f}  (n={len(scored)})")
    print(f"\nPer-question scores -> {out}")


if __name__ == "__main__":
    main()
