# Evaluation Harness (Objectives 2 & 4)

Compares the **Agentic Hybrid Multimodal RAG** model against a **standard
(naive) RAG baseline** and computes agent-specific metrics, using the RAGAS
framework.

> **Safety:** everything here is eval-only and additive. Nothing in the live
> application imports `app/agent/baseline.py` or anything in `eval/`, and the
> HITL escalation database insert is patched out during evaluation, so runs
> are **read-only against Supabase** — the production system is untouched.

## What's compared (Objective 2)

Both systems share the same Qdrant index, chunks, Cohere embeddings, DeepSeek
LLM, and top-K — the only variables are the agentic components:

| Component | Agentic (`app/agent/graph.py`) | Baseline (`app/agent/baseline.py`) |
|---|---|---|
| Intent triage + follow-up rewriting | ✅ | — |
| Query decomposition | ✅ (1–3 sub-queries) | — (single query) |
| Retrieval | Hybrid semantic + BM25 | Pure semantic top-K |
| Ranking | Reciprocal Rank Fusion | Raw similarity |
| Relevance grading G(ci) + routing | ✅ | — (always generates) |
| HITL escalation | ✅ | — (always answers) |

## Setup

```powershell
cd backend
.venv\Scripts\Activate.ps1
pip install -r eval/requirements-eval.txt
copy eval\testset.sample.csv eval\testset.csv   # then replace with your real test questions
```

`testset.csv` columns:

- `question` (required) — the test question
- `ground_truth` (required) — the reference answer (from the Student Manual)
- `reference_topics` (optional, `;`-separated) — allowed topics for Topic
  Adherence; defaults to a general ISU student-services list
- `reference` (optional) — expected interaction outcome for Goal Accuracy;
  defaults to `ground_truth`

Aim for **at least 20–30 questions** covering simple lookups, multi-part/
comparison questions (where the agentic model should shine), and a few
out-of-scope questions (to measure escalation behavior).

## Objective 2 — comparison (4 RAGAS metrics)

```powershell
python eval/ragas_eval.py            # runs BOTH systems, then scores
```

Outputs:

- `results_agentic.csv` / `results_baseline.csv` — per-question Faithfulness,
  Answer Relevancy, Context Recall, Context Precision
- `summary.csv` — mean of each metric side by side + answer/escalation rates
  (paste-ready for your results tables)

Notes:

- Escalated questions are excluded from RAGAS scoring (there is no generated
  answer to judge) but counted in `summary.csv` — report the escalation rate;
  it is a *behavioral feature* of the agentic model, not missing data.
- Raw answers are cached in `collected_*.json`; re-scoring is free. Use
  `--recollect` after changing the system or testset.

## Objective 4 — agent metrics

```powershell
python eval/agent_eval.py
```

- **4.1 Goal Accuracy** → `AgentGoalAccuracyWithReference`
- **4.2 F1-Score** → `TopicAdherenceScore(mode="f1")`
- **4.3 Adherence** → Topic Adherence precision & recall

Output: `results_agent_metrics.csv` + means printed.

## Judge model disclosure (for your methodology section)

RAGAS metrics are LLM-judged. The judge is whatever `LLM_MODEL` points at,
with temperature 0, and Cohere Embed v3 for the embedding-based parts of
Answer Relevancy. The reported thesis run (`iskolarchat_eval_colab.ipynb`)
used **Qwen 2.5 14B Instruct via local Ollama on a Colab GPU** as both
generator and judge; running the scripts locally against `.env` defaults
would use the project's DeepSeek/OpenRouter model instead. State the actual
model in your methodology, and keep the judge fixed across both systems
(the scripts already do).
