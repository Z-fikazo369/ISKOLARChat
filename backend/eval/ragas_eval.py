"""Objective 2 — Agentic RAG vs. standard RAG baseline (RAGAS).

Computes the four objective metrics for BOTH systems over the same
testset and writes per-question + side-by-side summary CSVs:

  2.1 Faithfulness        2.2 Answer Relevancy
  2.3 Context Recall      2.4 Context Precision

Usage (from the backend/ folder, venv active, .env filled in):
  pip install -r eval/requirements-eval.txt
  python eval/ragas_eval.py                     # run both systems
  python eval/ragas_eval.py --system agentic    # one system only
  python eval/ragas_eval.py --recollect         # ignore cached answers

Runs fully in-process: no JWT, no HTTP server needed, full (untruncated)
chunk texts are scored, and no rows are written to Supabase (the HITL
escalation insert is patched out — see eval/_common.py).

Outputs:
  eval/results_agentic.csv    per-question scores (agentic)
  eval/results_baseline.csv   per-question scores (baseline)
  eval/summary.csv            mean metrics side by side + answer rates
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import EVAL_DIR, build_judge, collect, load_collected  # noqa: E402

SYSTEMS = ("agentic", "baseline")


def score(system: str, rows: list[dict], judge_llm, judge_emb) -> dict:
    import warnings

    from ragas import EvaluationDataset, SingleTurnSample
    from ragas import evaluate as ragas_evaluate

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )

    answered = [r for r in rows if not r["escalated"]]
    print(
        f"\n=== {system}: scoring {len(answered)} answered "
        f"({len(rows) - len(answered)} escalated, excluded from RAGAS) ==="
    )
    if not answered:
        return {"system": system, "n": len(rows), "answered": 0, "escalated": len(rows), "answer_rate": 0.0}

    ds = EvaluationDataset(
        samples=[
            SingleTurnSample(
                user_input=r["question"],
                response=r["answer"],
                retrieved_contexts=r["contexts"],
                reference=r["ground_truth"],
            )
            for r in answered
        ]
    )
    # Free Gemini tier is ~15 req/min — cap concurrency and add generous
    # retries so the scoring paces itself under the rate limit instead of
    # bursting into 429s. (Eval-only.)
    from ragas.run_config import RunConfig

    result = ragas_evaluate(
        ds,
        metrics=[faithfulness, answer_relevancy, context_recall, context_precision],
        llm=judge_llm,
        embeddings=judge_emb,
        run_config=RunConfig(max_workers=3, max_retries=12, timeout=240),
    )
    df = result.to_pandas()
    out = EVAL_DIR / f"results_{system}.csv"
    df.to_csv(out, index=False)
    print(f"Per-question scores -> {out}")

    metric_cols = ["faithfulness", "answer_relevancy", "context_recall", "context_precision"]
    means = {m: round(float(df[m].mean()), 4) for m in metric_cols if m in df.columns}
    return {
        "system": system,
        "n": len(rows),
        "answered": len(answered),
        "escalated": len(rows) - len(answered),
        "answer_rate": round(len(answered) / len(rows), 4),
        **means,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--system", choices=[*SYSTEMS, "both"], default="both")
    ap.add_argument("--recollect", action="store_true", help="ignore cached collections")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between API calls")
    args = ap.parse_args()

    targets = SYSTEMS if args.system == "both" else (args.system,)

    collections = {}
    for system in targets:
        rows = None if args.recollect else load_collected(system)
        if rows is None:
            print(f"\n=== Collecting answers: {system} ===")
            rows = collect(system, delay=args.delay)
        else:
            print(f"Using cached eval/collected_{system}.json ({len(rows)} rows) — "
                  "pass --recollect to redo")
        collections[system] = rows

    judge_llm, judge_emb = build_judge()
    summaries = [score(s, collections[s], judge_llm, judge_emb) for s in targets]

    import pandas as pd

    summary_path = EVAL_DIR / "summary.csv"
    pd.DataFrame(summaries).to_csv(summary_path, index=False)
    print("\n=== Side-by-side summary (means) ===")
    print(pd.DataFrame(summaries).to_string(index=False))
    print(f"\nSaved -> {summary_path}")


if __name__ == "__main__":
    main()
