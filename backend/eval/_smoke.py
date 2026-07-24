"""One-question end-to-end smoke test for the eval pipeline (cheap).
Verifies: Cohere embeddings + Qdrant retrieval, baseline generation, agentic
graph, the RAGAS judge (Obj 2), and one agent metric (Obj 4) — so we don't
launch the full 56-question paid run on a broken pipeline. Run:
    python eval/_smoke.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import build_judge, full_contexts, run_agentic, run_baseline  # noqa: E402

Q = "What are the admission requirements for incoming freshmen?"
GT = ("Incoming freshmen must submit Form 138, a Certificate of Good Moral "
      "Character, a PSA Birth Certificate, and 2x2 ID pictures, and pass the "
      "admission test, interview, and medical exam.")

print("1) baseline (naive RAG)...")
b = run_baseline(Q)
print(f"   answer chars={len(b.get('answer',''))}  chunks={len(b.get('relevant') or [])}")
assert b.get("answer") and b.get("relevant"), "baseline produced no answer/chunks"

print("2) agentic RAG...")
a = run_agentic(Q)
print(f"   intent={a.get('intent')}  sub_queries={len(a.get('sub_queries') or [])}  "
      f"candidates={len(a.get('candidates') or [])}  relevant={len(a.get('relevant') or [])}  "
      f"escalated={a.get('escalated')}  answer chars={len(a.get('answer',''))}")
assert a.get("answer"), "agentic produced no answer"

print("3) building RAGAS judge...")
judge_llm, judge_emb = build_judge()

print("4) Obj 2 — scoring 1 sample (faithfulness, answer_relevancy)...")
import warnings
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from ragas import EvaluationDataset, SingleTurnSample
    from ragas import evaluate as ragas_evaluate
    from ragas.metrics import answer_relevancy, faithfulness
ds = EvaluationDataset(samples=[SingleTurnSample(
    user_input=Q, response=a["answer"], retrieved_contexts=full_contexts(a), reference=GT)])
res = ragas_evaluate(ds, metrics=[faithfulness, answer_relevancy],
                     llm=judge_llm, embeddings=judge_emb)
print("   Obj2 OK ->", res.to_pandas()[["faithfulness", "answer_relevancy"]].to_dict("records"))

print("5) Obj 4 — scoring 1 sample (goal accuracy)...")
from ragas.dataset_schema import MultiTurnSample
from ragas.messages import AIMessage, HumanMessage, ToolCall, ToolMessage
from ragas.metrics import AgentGoalAccuracyWithReference
sample = MultiTurnSample(
    user_input=[
        HumanMessage(content=Q),
        AIMessage(content="", tool_calls=[ToolCall(name="search_knowledge_base",
                  args={"queries": a.get("sub_queries") or [Q]})]),
        ToolMessage(content=f"Retrieved {len(a.get('relevant') or [])} graded chunks."),
        AIMessage(content=a["answer"]),
    ],
    reference=GT,
)
goal = AgentGoalAccuracyWithReference(llm=judge_llm)
score = asyncio.run(goal.multi_turn_ascore(sample))
print("   Obj4 OK -> goal_accuracy =", score)

print("\nSMOKE TEST PASSED — pipeline is healthy; safe to run the full 56-question eval.")
