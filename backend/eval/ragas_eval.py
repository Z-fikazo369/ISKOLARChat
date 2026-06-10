"""RAGAS evaluation harness (comparison baseline: faithfulness + answer relevancy).

Usage:
  1. pip install ragas datasets langchain-openai pandas
  2. Prepare eval/testset.csv with columns: question,ground_truth
  3. Start the backend, then:  python eval/ragas_eval.py <student_jwt>

The script calls /api/chat for every test question, collects answers and
retrieved contexts, and computes RAGAS metrics.
"""

import csv
import sys
from pathlib import Path

import requests

API_URL = "http://localhost:8000"
TESTSET = Path(__file__).parent / "testset.csv"


def collect(jwt: str) -> list[dict]:
    rows = []
    with open(TESTSET, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            resp = requests.post(
                f"{API_URL}/api/chat",
                json={"question": row["question"]},
                headers={"Authorization": f"Bearer {jwt}"},
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()
            rows.append(
                {
                    "question": row["question"],
                    "ground_truth": row["ground_truth"],
                    "answer": data["answer"],
                    "contexts": [s["snippet"] for s in data["sources"]] or [""],
                    "escalated": data["escalated"],
                }
            )
            print(f"✓ {row['question'][:60]}  (escalated={data['escalated']})")
    return rows


def evaluate(rows: list[dict]) -> None:
    from datasets import Dataset
    from ragas import evaluate as ragas_evaluate
    from ragas.metrics import answer_relevancy, faithfulness

    ds = Dataset.from_list(
        [
            {
                "question": r["question"],
                "answer": r["answer"],
                "contexts": r["contexts"],
                "ground_truth": r["ground_truth"],
            }
            for r in rows
            if not r["escalated"]
        ]
    )
    result = ragas_evaluate(ds, metrics=[faithfulness, answer_relevancy])
    print("\n=== RAGAS metrics ===")
    print(result)
    result.to_pandas().to_csv(Path(__file__).parent / "results.csv", index=False)
    print("Saved per-question scores to eval/results.csv")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Usage: python eval/ragas_eval.py <student_jwt>")
    evaluate(collect(sys.argv[1]))
