# ISKOLARChat RAG Backend

FastAPI service implementing the agentic RAG architecture:

| Diagram component | Code |
|---|---|
| Document upload + processing queue (Phase 1) | `app/workers/document_ingestion.py` (durable Supabase queue) |
| PDF text extraction — PyMuPDF (Phase 2.1) | `app/pipeline/extract.py` |
| Multimodal captioning — Moondream (Phase 2.2) | `app/pipeline/caption.py` (tables → markdown in `extract.py`) |
| Semantic chunking with overlap (Phase 2.3) | `app/pipeline/chunk.py` |
| Cohere Embed v3 (Phase 2.4) | `app/services/embeddings.py` |
| Qdrant Cloud indexing (Phase 2.5) | `app/services/vectorstore.py` |
| Hybrid retrieval: semantic + BM25 (Phase 3.1) | `app/services/retrieval.py`, `app/services/bm25.py` |
| Reciprocal Rank Fusion (Phase 3.2) | `_rrf_merge` in `app/services/retrieval.py` |
| LangGraph agent: decompose → grade G(ci) → route (Phase 4) | `app/agent/graph.py` |
| Grounded generation (Gemini, provider-configurable) | `generate` node in `app/agent/graph.py` |
| HITL escalation + dashboard | `escalate` node → `chat_requests` table → AdminDashboard |
| Knowledge loop (auto-ingest verified answers) | `app/routers/hitl.py` → `ingest_hitl_answer` |
| RAGAS metrics | `eval/ragas_eval.py` |

## Setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Create .env manually, then add the required keys listed below.
```

Required accounts/keys:
1. **Supabase** — project URL + `service_role` key (Settings → API). Run
   every file in `supabase/migrations/` in numeric order in the SQL Editor first.
2. **Qdrant Cloud** — free cluster at cloud.qdrant.io.
3. **Cohere** — trial key at dashboard.cohere.com.
4. **Google AI Studio** — Gemini API key; model modes are configured through
   `LLM_FLASH_MODEL`, `LLM_PRO_MODEL`, and `LLM_REASONING_MODEL`.
5. **Moondream** (optional) — image captioning; skipped if key is empty.

## Run

```powershell
uvicorn app.main:app --reload --port 8000
```

Frontend expects the API at `http://localhost:8000` (override with
`VITE_API_URL` in `.env.local`).

## Endpoints

- `POST /api/chat` — student question → agentic RAG answer or HITL escalation
- `POST /api/documents/{id}/ingest` — queue an uploaded PDF for ingestion (admin)
- `DELETE /api/documents/{id}` — remove file + vectors + DB row (admin)
- `POST /api/hitl/{id}/resolve` — answer an escalated query and re-ingest it (admin)
- `POST /api/admin-applications/{id}/review` — atomic approval/rejection (superadmin)
- `GET /api/health` — liveness (the process is running)
- `GET /api/health/ready` — readiness (configuration, dependencies, and worker)

`POST /api/compare` is disabled by default. A controlled deployment must set
`COMPARE_ENDPOINT_ENABLED=true`; enabled calls still require authentication.

Protected endpoints take the Supabase session JWT as
`Authorization: Bearer <token>`; the React helper `src/lib/api.js` adds it
automatically. Liveness/readiness remain unauthenticated for deployment probes.

## Evaluation (RAGAS)

```powershell
pip install ragas datasets pandas
# create eval/testset.csv with columns: question,ground_truth
python eval/ragas_eval.py <student_jwt>
```
