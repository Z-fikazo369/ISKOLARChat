import { useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Send, Loader2, ChevronDown, ChevronRight, BarChart3, Users, ShieldAlert, Target, CheckCircle2, Columns2, AlertTriangle, XCircle, CheckCircle, Info, ArrowRight, MessageSquare, Search, Filter, Zap, UserCheck } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useTitle } from "../../hooks/useTitle";

// Standalone, unlinked transparency view: runs the same naive RAG and agentic
// RAG over the same index and shows them side by side. POST /api/compare only;
// read-only (writes nothing to the DB).
//
// Layout: page-level menu with three views — the live comparison, the RAGAS
// quality report, and the agent-specific report each open as their own
// full-width tab (no sidebar), so every report has room to breathe.

// ── Static evaluation results (thesis Objectives 2 & 4) ─────────────────────
// Numbers come from the offline eval harness (backend/eval) run on the
// 56-question Student Manual testset:
//   eval_results/summary.csv               → RAGAS comparison + answer rates
//   eval_results/results_agent_summary.csv → agent-specific metrics
// If the testset or either pipeline changes, re-run ragas_eval.py /
// agent_eval.py and update these constants.
const EVAL_N = 56;

const RAGAS_METRICS = [
  {
    short: "Faith.",
    label: "Faithfulness",
    naive: 0.9565,
    agentic: 0.9072,
    desc: "Is every claim in the answer actually supported by the retrieved context? Low = hallucination.",
  },
  {
    short: "Ans. Rel.",
    label: "Answer Relevancy",
    naive: 0.5752,
    agentic: 0.6063,
    desc: "Does the answer directly address the question asked, without drifting off-topic?",
  },
  {
    short: "Ctx. Rec.",
    label: "Context Recall",
    naive: 0.9777,
    agentic: 0.8641,
    desc: "Did retrieval find all the information needed to produce the ground-truth answer?",
  },
  {
    short: "Ctx. Prec.",
    label: "Context Precision",
    naive: 0.7878,
    agentic: 0.881,
    desc: "Are the truly relevant chunks ranked at the top of what was retrieved (less noise)?",
  },
];

const BEHAVIOR = {
  naiveAnswered: 56, // baseline always generates, even when it shouldn't
  agenticAnswered: 42,
  escalated: 14, // routed to a human admin instead of guessing
};

const AGENT_METRICS = [
  {
    label: "Goal Accuracy",
    value: 0.4464,
    icon: Target,
    color: "#6366f1",
    bg: "rgba(99,102,241,.12)",
    desc: "Did the agent fully accomplish what the user asked for, end to end, as judged by the LLM?",
  },
  {
    label: "Topic Adh. F1",
    value: 0.7125,
    icon: CheckCircle2,
    color: "#10b981",
    bg: "rgba(16,185,129,.12)",
    desc: "Overall balance of precision and recall — how well the agent stays within allowed ISU topics.",
  },
  {
    label: "Topic Precision",
    value: 0.6607,
    icon: Users,
    color: "#f59e0b",
    bg: "rgba(245,158,11,.12)",
    desc: "Of the topics the agent engaged with, how many were actually allowed student-services topics?",
  },
  {
    label: "Topic Recall",
    value: 0.8393,
    icon: ShieldAlert,
    color: "#0ea5e9",
    bg: "rgba(14,165,233,.12)",
    desc: "Of the allowed topics users asked about, how many did the agent correctly handle?",
  },
];

// Score-range interpretation shared by both reports (all metrics are 0–1).
const SCORE_BANDS = [
  { min: 0.9, range: "0.90 – 1.00", label: "Excellent", color: "#16a34a", meaning: "Near-perfect — the system almost always gets this right." },
  { min: 0.7, range: "0.70 – 0.89", label: "Good", color: "#65a30d", meaning: "Strong, dependable performance with minor misses." },
  { min: 0.5, range: "0.50 – 0.69", label: "Moderate", color: "#f59e0b", meaning: "Acceptable but inconsistent — clear room to improve." },
  { min: 0, range: "0.00 – 0.49", label: "Low", color: "#ef4444", meaning: "Weak on this measure — interpret results with caution." },
];

const scoreBand = (v) => SCORE_BANDS.find((b) => v >= b.min);

const NAIVE_COLOR = "#cbd5e1";
const AGENTIC_COLOR = "var(--primary)";
const ESCALATE_COLOR = "#f59e0b";

const CARD_SHADOW = "0 1px 3px rgba(16,24,40,.06), 0 1px 2px rgba(16,24,40,.04)";

const SAMPLES = [
  "What are the admission requirements for incoming freshmen?",
  "How much is the cash incentive for the Entrance Scholarship?",
  "What are the rules on dropping subjects and how do I shift programs?",
  "What is the dress code and the policy on student absences?",
];

// Grade score color: maps 0-1 grade to a color for visual feedback.
function gradeColor(score) {
  if (score >= 0.8) return "#16a34a";
  if (score >= 0.5) return "#65a30d";
  if (score >= 0.4) return "#f59e0b";
  if (score > 0) return "#f97316";
  return "#ef4444";
}

// Grade label corresponding to the rubric used by the LLM grader.
function gradeLabel(score) {
  if (score >= 0.8) return "Direct answer";
  if (score >= 0.4) return "Supporting context";
  if (score > 0) return "Loosely related";
  return "Unrelated";
}

// Horizontal bar showing grade score visually (0-1 scale).
function GradeBar({ score, threshold }) {
  const color = gradeColor(score);
  const passed = threshold != null ? score >= threshold : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: "var(--muted)",
          position: "relative",
          maxWidth: 120,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(score * 100, 2)}%`,
            height: "100%",
            borderRadius: 3,
            background: color,
            transition: "width 0.3s ease",
          }}
        />
        {threshold != null && (
          <div
            style={{
              position: "absolute",
              left: `${threshold * 100}%`,
              top: -2,
              bottom: -2,
              width: 2,
              background: "var(--foreground)",
              opacity: 0.4,
            }}
            title={`Threshold: ${threshold}`}
          />
        )}
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color,
          minWidth: 32,
        }}
      >
        {score.toFixed(2)}
      </span>
      {passed != null && (
        passed ? (
          <CheckCircle size={13} style={{ color: "#16a34a", flexShrink: 0 }} />
        ) : (
          <XCircle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
        )
      )}
    </div>
  );
}

// One muted, right-aligned score per chunk (whichever is most relevant).
function chunkScore(c) {
  if (c.grade_score != null) return ["relevance", c.grade_score];
  if (c.rrf_score != null) return ["RRF", c.rrf_score];
  if (c.semantic_score != null) return ["similarity", c.semantic_score];
  return null;
}

function Chunk({ c, threshold, showGradeDetail }) {
  const [open, setOpen] = useState(false);
  const text = c.text || "";
  const long = text.length > 220;
  const shown = open || !long ? text : text.slice(0, 220) + "\u2026";
  const score = chunkScore(c);
  const hasGrade = c.grade_score != null;
  const passed = hasGrade && threshold != null ? c.grade_score >= threshold : null;
  return (
    <div
      style={{
        padding: "10px 0",
        borderTop: "1px solid var(--border)",
        ...(passed === false && showGradeDetail
          ? { opacity: 0.6 }
          : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          fontSize: 12,
          color: "var(--muted-foreground)",
          marginBottom: 4,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.rank}. {c.document_name || "document"}
          {c.page ? `, p.${c.page}` : ""}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {score && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {score[0]} {Number(score[1]).toFixed(2)}
            </span>
          )}
          {passed === true && showGradeDetail && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#16a34a",
                background: "rgba(22,163,74,.1)",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              PASS
            </span>
          )}
          {passed === false && showGradeDetail && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#ef4444",
                background: "rgba(239,68,68,.1)",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              FAIL
            </span>
          )}
        </span>
      </div>
      {hasGrade && showGradeDetail && (
        <div style={{ marginBottom: 6 }}>
          <GradeBar score={c.grade_score} threshold={threshold} />
          <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2, display: "block" }}>
            {gradeLabel(c.grade_score)}
          </span>
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--text-secondary, var(--foreground))",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {shown}
      </p>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            marginTop: 4,
            fontSize: 11.5,
            color: "var(--muted-foreground)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          {open ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "var(--muted-foreground)",
        margin: "18px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--card)",
        boxShadow: CARD_SHADOW,
        padding: "18px 20px",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function Column({ title, subtitle, accent, children }) {
  return (
    <Card style={{ flex: 1, minWidth: 300 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: accent,
            flexShrink: 0,
          }}
        />
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "var(--foreground)" }}>
          {title}
        </h2>
      </div>
      <p style={{ margin: "3px 0 0 17px", fontSize: 12, color: "var(--muted-foreground)" }}>
        {subtitle}
      </p>
      {children}
    </Card>
  );
}

function Answer({ text, muted }) {
  return (
    <div
      className="md-body"
      style={{
        fontSize: 13.5,
        lineHeight: 1.6,
        color: muted ? "var(--muted-foreground)" : "var(--foreground)",
        fontStyle: muted ? "italic" : "normal",
      }}
    >
      <ReactMarkdown>{text || "_(no answer)_"}</ReactMarkdown>
    </div>
  );
}

// ── Sidebar visualizations ──────────────────────────────────────────────────

function LegendDot({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted-foreground)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

// Grouped vertical bar chart (SVG, no deps): 4 RAGAS metrics × 2 systems,
// groups sorted highest → lowest score.
function RagasBarChart() {
  const metrics = [...RAGAS_METRICS].sort(
    (a, b) => Math.max(b.naive, b.agentic) - Math.max(a.naive, a.agentic)
  );
  const W = 340;
  const H = 200;
  const pad = { top: 18, bottom: 26, left: 6, right: 6 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const groupW = innerW / metrics.length;
  const barW = 23;
  const pairGap = 6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* gridlines */}
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line
          key={g}
          x1={pad.left}
          x2={W - pad.right}
          y1={pad.top + innerH * (1 - g)}
          y2={pad.top + innerH * (1 - g)}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ))}
      {metrics.map((m, i) => {
        const x0 = pad.left + i * groupW + (groupW - (barW * 2 + pairGap)) / 2;
        const nH = m.naive * innerH;
        const aH = m.agentic * innerH;
        const naiveBest = m.naive > m.agentic;
        return (
          <g key={m.label}>
            <rect
              x={x0}
              y={pad.top + innerH - nH}
              width={barW}
              height={nH}
              rx="4"
              fill={NAIVE_COLOR}
            >
              <title>{`${m.label} — Naive RAG: ${m.naive.toFixed(4)}`}</title>
            </rect>
            <rect
              x={x0 + barW + pairGap}
              y={pad.top + innerH - aH}
              width={barW}
              height={aH}
              rx="4"
              fill={AGENTIC_COLOR}
            >
              <title>{`${m.label} — Agentic RAG: ${m.agentic.toFixed(4)}`}</title>
            </rect>
            <text
              x={x0 + barW / 2}
              y={pad.top + innerH - nH - 5}
              textAnchor="middle"
              fontSize="10"
              fontWeight={naiveBest ? 700 : 400}
              fill="var(--muted-foreground)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {m.naive.toFixed(2).replace(/^0/, "")}
            </text>
            <text
              x={x0 + barW + pairGap + barW / 2}
              y={pad.top + innerH - aH - 5}
              textAnchor="middle"
              fontSize="10"
              fontWeight={naiveBest ? 400 : 700}
              fill="var(--foreground)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {m.agentic.toFixed(2).replace(/^0/, "")}
            </text>
            <text
              x={pad.left + i * groupW + groupW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize="10.5"
              fill="var(--muted-foreground)"
            >
              {m.short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Donut: agentic answer rate (answered vs escalated-to-human).
function AnswerRateDonut() {
  const size = 136;
  const r = 54;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const answeredFrac = BEHAVIOR.agenticAnswered / EVAL_N;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={ESCALATE_COLOR} strokeWidth="14" opacity="0.9" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={AGENTIC_COLOR}
        strokeWidth="14"
        strokeDasharray={`${C * answeredFrac} ${C}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize="22"
        fontWeight="700"
        fill="var(--foreground)"
      >
        {Math.round(answeredFrac * 100)}%
      </text>
      <text x={cx} y={cy + 17} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
        answered
      </text>
    </svg>
  );
}

// Colored pill showing which score band a value falls in ("pag ganito ang
// value, eto ibig sabihin").
function BandBadge({ value }) {
  const b = scoreBand(value);
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: b.color,
        background: `color-mix(in srgb, ${b.color} 12%, transparent)`,
        borderRadius: 999,
        padding: "1.5px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {b.label}
    </span>
  );
}

// "How to read the scores" — the 0–1 range bands and what each one means.
function ScoreGuide({ style }) {
  const muted = "var(--muted-foreground)";
  return (
    <Card style={style}>
      <h3 style={{ margin: "0 0 4px", fontSize: 13.5, fontWeight: 700, color: "var(--foreground)" }}>
        How to Read the Scores
      </h3>
      <p style={{ margin: "0 0 10px", fontSize: 11.5, lineHeight: 1.55, color: muted }}>
        Every metric is scored from 0 to 1 (higher is better). The value falls
        in one of these ranges:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {SCORE_BANDS.map((b) => (
          <div key={b.label} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: b.color,
                flexShrink: 0,
                width: 76,
              }}
            >
              {b.range}
            </span>
            <span style={{ color: "var(--foreground)" }}>
              <b>{b.label}</b>
              <span style={{ color: muted }}> — {b.meaning}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Standard footnote under each report view.
function ReportFootnote() {
  return (
    <p style={{ margin: "16px 4px 0", fontSize: 11, lineHeight: 1.6, color: "var(--muted-foreground)", maxWidth: 720 }}>
      LLM-as-judge: Qwen 2.5 14B Instruct via Ollama (temp 0) as both
      generator and judge for the two systems, with Cohere Embed v3
      embeddings and the same Qdrant index. Escalated questions are excluded
      from RAGAS answer scoring and reported via the answer rate instead.
      Full per-question results in{" "}
      <code style={{ fontSize: 10.5 }}>eval_results/</code>.
    </p>
  );
}

// Report view 1: RAGAS quality comparison — big chart + what each metric means.
function RagasReport() {
  const muted = "var(--muted-foreground)";
  const sorted = [...RAGAS_METRICS].sort(
    (a, b) => Math.max(b.naive, b.agentic) - Math.max(a.naive, a.agentic)
  );
  return (
    <>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <Card style={{ flex: "1.3 1 400px", minWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <BarChart3 size={18} style={{ color: "var(--primary)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--foreground)" }}>
              RAGAS Quality Comparison
            </h2>
          </div>
          <p style={{ margin: "6px 0 16px", fontSize: 12.5, lineHeight: 1.6, color: muted }}>
            Compares answer and retrieval quality of the two pipelines on the
            same {EVAL_N}-question Student Manual testset, scored by an LLM
            judge. Bars are arranged from highest to lowest score.
          </p>
          <RagasBarChart />
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
            <LegendDot color={NAIVE_COLOR} label="Naive RAG" />
            <LegendDot color="var(--primary)" label="Agentic RAG" />
          </div>
        </Card>

        <Card style={{ flex: "1 1 320px", minWidth: 300 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>
            What Each Metric Measures
          </h3>
          <p style={{ margin: "0 0 14px", fontSize: 11.5, color: muted }}>
            Same order as the chart. The badge rates the better of the two
            systems.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {sorted.map((m) => (
              <div key={m.label}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: 11.5, color: muted, fontVariantNumeric: "tabular-nums" }}>
                    naive {m.naive.toFixed(2)} · agentic {m.agentic.toFixed(2)}
                  </span>
                  <BandBadge value={Math.max(m.naive, m.agentic)} />
                </div>
                <p style={{ margin: "3px 0 0", fontSize: 11.5, lineHeight: 1.55, color: muted }}>
                  {m.desc}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <ScoreGuide style={{ marginTop: 16 }} />
      <ReportFootnote />
    </>
  );
}

// Report view 2: agent-specific metrics + answer/escalation behavior.
function AgentReport() {
  const muted = "var(--muted-foreground)";
  return (
    <>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <Card style={{ flex: "1.3 1 400px", minWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <Target size={18} style={{ color: "var(--primary)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--foreground)" }}>
              Agent-Specific Metrics
            </h2>
          </div>
          <p style={{ margin: "6px 0 16px", fontSize: 12.5, lineHeight: 1.6, color: muted }}>
            Measures behaviors only the agentic system has — completing the
            user&apos;s goal, staying on allowed topics, and escalating to a
            human instead of guessing. Naive RAG has no equivalent.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {AGENT_METRICS.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  style={{
                    display: "flex",
                    gap: 12,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "12px 13px",
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: m.bg,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={18} style={{ color: m.color }} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 17,
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--foreground)",
                        }}
                      >
                        {m.value.toFixed(4)}
                      </span>
                      <BandBadge value={m.value} />
                    </span>
                    <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
                      {m.label}
                    </span>
                    <span style={{ display: "block", fontSize: 11, lineHeight: 1.5, color: muted, marginTop: 2 }}>
                      {m.desc}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card style={{ flex: "1 1 320px", minWidth: 300 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>
            Answer vs. Escalation Rate
          </h3>
          <p style={{ margin: "0 0 16px", fontSize: 11.5, lineHeight: 1.55, color: muted }}>
            How often the agent answers versus hands the question to a human
            admin when retrieval can&apos;t support a grounded answer.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <AnswerRateDonut />
            <div style={{ fontSize: 12.5, lineHeight: 1.8, color: "var(--foreground)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />
                <b>{BEHAVIOR.agenticAnswered}</b>&nbsp;answered
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: ESCALATE_COLOR, flexShrink: 0 }} />
                <b>{BEHAVIOR.escalated}</b>&nbsp;escalated to human
              </div>
            </div>
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 11.5, lineHeight: 1.6, color: muted }}>
            Naive answers {BEHAVIOR.naiveAnswered}/{EVAL_N} (100%) — it always
            generates an answer, even without supporting context. The agentic
            system refusing to guess on {BEHAVIOR.escalated} questions is the
            safety behavior being measured here.
          </p>
        </Card>
      </div>
      <ScoreGuide style={{ marginTop: 16 }} />
      <ReportFootnote />
    </>
  );
}

// Page-level menu: each testing result opens as its own full-width view.
const VIEW_TABS = [
  { id: "live", label: "Live Comparison", icon: Columns2 },
  { id: "ragas", label: "Standard RAGAS", icon: BarChart3 },
  { id: "agent", label: "Agentic RAGAS", icon: Target },
];

function ViewMenu({ view, setView }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        background: "var(--muted)",
        borderRadius: 12,
        padding: 4,
        marginBottom: 20,
        maxWidth: "100%",
        flexWrap: "wrap",
      }}
    >
      {VIEW_TABS.map((t) => {
        const Icon = t.icon;
        const active = view === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              color: active ? "var(--foreground)" : "var(--muted-foreground)",
              background: active ? "var(--card)" : "transparent",
              border: "none",
              borderRadius: 9,
              padding: "9px 16px",
              cursor: "pointer",
              boxShadow: active ? CARD_SHADOW : "none",
              whiteSpace: "nowrap",
            }}
          >
            <Icon size={15} style={{ color: active ? "var(--primary)" : "currentColor", flexShrink: 0 }} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

// Pipeline flow step indicator — shows the agentic pipeline stages with
// active/completed/failed states for maximum transparency.
function PipelineFlow({ agentic, grading }) {
  const steps = [
    { id: "classify", label: "Classify", icon: MessageSquare, status: "done" },
    { id: "decompose", label: "Decompose", icon: Zap, status: "done" },
    { id: "retrieve", label: "Retrieve", icon: Search, status: "done" },
    {
      id: "grade",
      label: "Grade",
      icon: Filter,
      status: "done",
      detail: grading
        ? `${agentic.relevant?.length || 0}/${(agentic.graded_candidates || agentic.candidates)?.length || 0} passed`
        : null,
    },
    {
      id: "route",
      label: agentic.escalated ? "Escalate" : "Generate",
      icon: agentic.escalated ? UserCheck : CheckCircle2,
      status: agentic.escalated ? "escalated" : "done",
    },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", margin: "12px 0 4px" }}>
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isEscalated = step.status === "escalated";
        const color = isEscalated ? ESCALATE_COLOR : "var(--primary)";
        const bg = isEscalated ? "rgba(245,158,11,.10)" : "rgba(var(--primary-rgb, 59,130,246),.08)";
        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 8,
                background: bg,
                border: `1px solid ${isEscalated ? "rgba(245,158,11,.3)" : "transparent"}`,
              }}
            >
              <Icon size={13} style={{ color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color, whiteSpace: "nowrap" }}>
                {step.label}
              </span>
              {step.detail && (
                <span style={{ fontSize: 10, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                  ({step.detail})
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <ChevronRight size={13} style={{ color: "var(--muted-foreground)", margin: "0 2px", flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Enhanced HITL escalation banner with detailed breakdown.
function HitlEscalationBanner({ agentic, grading }) {
  const [showDetails, setShowDetails] = useState(true);
  const threshold = grading?.threshold ?? 0.5;
  const graderModel = grading?.grader_model || "unknown";
  const gradedList = agentic.graded_candidates || [];
  const nCandidates = gradedList.length || agentic.candidates?.length || 0;
  const nPassed = agentic.relevant?.length || 0;
  const nFailed = nCandidates - nPassed;
  const allZero = gradedList.length > 0 && gradedList.every((c) => (c.grade_score ?? 0) === 0);

  return (
    <div
      style={{
        background: "rgba(245, 158, 11, 0.06)",
        border: "1px solid rgba(245, 158, 11, 0.35)",
        borderRadius: 12,
        marginTop: 14,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: showDetails ? "1px solid rgba(245,158,11,.15)" : "none",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "rgba(245,158,11,.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={18} style={{ color: ESCALATE_COLOR }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESCALATE_COLOR }}>
            Human-in-the-Loop Escalation Triggered
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted-foreground)" }}>
            {allZero
              ? "All retrieved chunks scored 0.0 — the knowledge base does not cover this topic."
              : `No chunk met the relevance threshold (${threshold}) — question forwarded to human admin.`}
          </p>
        </div>
        <button
          onClick={() => setShowDetails((v) => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--muted-foreground)",
            flexShrink: 0,
          }}
        >
          <ChevronDown size={16} style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>
      </div>

      {showDetails && (
        <div style={{ padding: "12px 16px 16px" }}>
          {/* What happens in production */}
          <div
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 14,
              padding: "10px 12px",
              background: "rgba(245,158,11,.05)",
              borderRadius: 8,
              border: "1px dashed rgba(245,158,11,.2)",
            }}
          >
            <Info size={14} style={{ color: ESCALATE_COLOR, flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--muted-foreground)" }}>
              <b style={{ color: "var(--foreground)" }}>In the live system:</b> The student
              would see a &ldquo;forwarded to admin staff&rdquo; message. An admin reviews and
              answers the question in the HITL queue, and the verified answer is automatically
              ingested into the knowledge base so future students get it instantly.
            </div>
          </div>

          {/* Grading summary stats */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div
              style={{
                flex: "1 1 120px",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--card)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)" }}>{nCandidates}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>Candidates retrieved</div>
            </div>
            <div
              style={{
                flex: "1 1 120px",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--card)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: "#ef4444" }}>{nFailed}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>Below threshold</div>
            </div>
            <div
              style={{
                flex: "1 1 120px",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--card)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>{nPassed}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>Passed grading</div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
            Grader: <code style={{ fontSize: 10.5, background: "var(--muted)", padding: "1px 5px", borderRadius: 4 }}>{graderModel}</code>
            {" "} | Threshold: <b>{threshold}</b>
            {" "} | Min relevant chunks: <b>{grading?.min_relevant_chunks ?? 1}</b>
          </p>
        </div>
      )}
    </div>
  );
}

// Grading rubric card for the agentic column — shows how the LLM grades chunks.
function GradingRubric({ grading }) {
  const [open, setOpen] = useState(false);
  const threshold = grading?.threshold ?? 0.5;
  const rubric = [
    { range: "0.8 \u2013 1.0", label: "Direct answer", color: "#16a34a", desc: "Chunk directly answers or contains the specific information asked for." },
    { range: "0.4 \u2013 0.7", label: "Supporting context", color: "#f59e0b", desc: "Same topic, useful supporting context, but doesn't directly answer." },
    { range: "0.1 \u2013 0.3", label: "Loosely related", color: "#f97316", desc: "Related keywords but about a different aspect of the topic." },
    { range: "0.0", label: "Unrelated", color: "#ef4444", desc: "Completely unrelated to the question." },
  ];
  return (
    <div style={{ marginTop: 12, marginBottom: 4 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--muted-foreground)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <Info size={13} style={{ flexShrink: 0 }} />
        {open ? "Hide" : "Show"} grading rubric
        <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--muted)",
            fontSize: 11.5,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--foreground)" }}>
            LLM Relevance Grading Rubric (threshold: {threshold})
          </p>
          {rubric.map((r) => (
            <div key={r.range} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: r.color, minWidth: 70, fontVariantNumeric: "tabular-nums" }}>
                {r.range}
              </span>
              <span>
                <b style={{ color: "var(--foreground)" }}>{r.label}</b>
                <span style={{ color: "var(--muted-foreground)" }}> — {r.desc}</span>
              </span>
            </div>
          ))}
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--muted-foreground)",
            }}
          >
            Chunks scoring <b>&ge; {threshold}</b> are accepted as relevant context.
            Below this threshold, chunks are filtered out. If no chunk passes, the
            system escalates to a human admin (HITL).
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompareView() {
  useTitle("RAG Comparison");
  const [view, setView] = useState("live");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [showGradedCandidates, setShowGradedCandidates] = useState(false);

  const run = async (q) => {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setQuestion(text);
    setLoading(true);
    setError("");
    setShowCandidates(false);
    setShowGradedCandidates(false);
    try {
      const data = await apiFetch("/api/compare", {
        method: "POST",
        body: JSON.stringify({ question: text }),
      });
      // Normalize before storing: an odd/partial response shape must show a
      // clean error, not a white screen from naive.chunks.length below.
      if (!data?.naive || !data?.agentic) {
        throw new Error("The comparison service returned an incomplete response.");
      }
      const escalated = data.agentic.escalated;
      setResult({
        ...data,
        naive: { ...data.naive, answer: data.naive.answer ?? "", chunks: data.naive.chunks ?? [] },
        agentic: {
          ...data.agentic,
          answer: data.agentic.answer ?? "",
          sub_queries: data.agentic.sub_queries ?? [],
          candidates: data.agentic.candidates ?? [],
          graded_candidates: data.agentic.graded_candidates ?? [],
          relevant: data.agentic.relevant ?? [],
          grading: data.agentic.grading ?? null,
        },
      });
      // Auto-expand the graded candidates view when escalated so the user
      // can immediately see why every chunk failed.
      if (escalated) {
        setShowGradedCandidates(true);
      }
    } catch (e) {
      setError(e.message || "Comparison failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const s = result?.settings;
  const naive = result?.naive;
  const agentic = result?.agentic;
  // Grading metadata returned by the agentic pipeline (threshold, model, etc.)
  const gradingMeta = agentic?.grading ?? null;
  const threshold = gradingMeta?.threshold ?? s?.relevance_threshold ?? 0.5;
  const nSub = agentic?.sub_queries?.length || 0;
  const gradedCandidates = agentic?.graded_candidates || [];

  const muted = "var(--muted-foreground)";

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" }}>
      <style>{`
        .md-body p { margin: 0 0 8px; } .md-body p:last-child { margin-bottom: 0; }
        .md-body ul, .md-body ol { margin: 0 0 8px; padding-left: 20px; }
        .md-body li { margin: 2px 0; }
        .md-body strong { font-weight: 700; }
        .md-body code { background: var(--muted); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ maxWidth: 1340, margin: "0 auto", padding: "28px 24px 72px" }}>
        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: muted,
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={15} /> Back to ISKOLARChat
        </Link>

        <h1 style={{ margin: "16px 0 6px", fontSize: 22, fontWeight: 700 }}>
          Naive RAG vs. Agentic RAG
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 13.5, lineHeight: 1.6, color: muted, maxWidth: 660 }}>
          Same knowledge base, embeddings, and LLM — the only difference is the agentic
          layer (decomposition, hybrid retrieval + RRF, relevance grading). Read-only.
        </p>

        {/* Menu: live comparison + each evaluation report as its own view */}
        <ViewMenu view={view} setView={setView} />

        {view === "ragas" && <RagasReport />}
        {view === "agent" && <AgentReport />}

        {view === "live" && (
          <main style={{ minWidth: 0 }}>
            {/* Query bar */}
            <Card style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="Ask an ISU student-services question\u2026"
                  style={{
                    flex: 1,
                    padding: "11px 14px",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: 14,
                    fontFamily: "inherit",
                    outline: "none",
                    minWidth: 0,
                  }}
                />
                <button
                  onClick={() => run()}
                  disabled={loading || !question.trim()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    background: "var(--primary)",
                    color: "var(--primary-foreground, #fff)",
                    border: "none",
                    borderRadius: 10,
                    padding: "0 18px",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: loading || !question.trim() ? "not-allowed" : "pointer",
                    opacity: loading || !question.trim() ? 0.55 : 1,
                  }}
                >
                  {loading ? (
                    <Loader2 size={15} style={{ animation: "spin 0.8s linear infinite" }} />
                  ) : (
                    <Send size={15} />
                  )}
                  {loading ? "Comparing" : "Compare"}
                </button>
              </div>

              {/* Sample chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {SAMPLES.map((q) => (
                  <button
                    key={q}
                    onClick={() => run(q)}
                    disabled={loading}
                    style={{
                      fontSize: 12,
                      color: muted,
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "5px 12px",
                      cursor: loading ? "not-allowed" : "pointer",
                    }}
                  >
                    {q.length > 46 ? q.slice(0, 46) + "\u2026" : q}
                  </button>
                ))}
              </div>
            </Card>

            {loading && (
              <p style={{ marginTop: 20, fontSize: 13.5, color: muted }}>
                Running both systems\u2026 (a few seconds)
              </p>
            )}
            {error && <p style={{ marginTop: 20, fontSize: 13.5, color: "#ef4444" }}>{error}</p>}

            {result && (
              <>
                {/* Summary card */}
                <Card
                  style={{
                    marginTop: 16,
                    padding: "14px 18px",
                    ...(agentic.escalated
                      ? { borderColor: "rgba(245, 158, 11, 0.4)", background: "rgba(245, 158, 11, 0.04)" }
                      : {}),
                  }}
                >
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--foreground)" }}>
                    Naive kept <b>{naive.chunks.length}</b> chunks (semantic top-K, no filtering).
                    Agentic split the question into <b>{nSub || 1}</b> sub-quer{(nSub || 1) > 1 ? "ies" : "y"},
                    fused with RRF, then kept <b>{agentic.relevant.length}</b> of{" "}
                    <b>{gradedCandidates.length || agentic.candidates.length}</b> after relevance grading
                    {agentic.escalated ? (
                      <span style={{ color: ESCALATE_COLOR, fontWeight: 700 }}>
                        {" "}&mdash; HITL escalation triggered (no answer generated)
                      </span>
                    ) : ""}.
                  </p>
                  {s && (
                    <p style={{ margin: "6px 0 0", fontSize: 11.5, color: muted }}>
                      top-K {s.final_top_k} · RRF k {s.rrf_k} · relevance &ge; {s.relevance_threshold} · {s.embed_model} · {s.llm_model}
                    </p>
                  )}
                </Card>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                    marginTop: 16,
                    alignItems: "flex-start",
                  }}
                >
                  {/* ── Naive Column ── */}
                  <Column title="Naive RAG" subtitle="Semantic top-K \u2192 answer (no filtering)" accent={NAIVE_COLOR}>
                    <Label>Answer</Label>
                    <Answer text={naive.answer} />
                    <Label>Retrieved context · {naive.chunks.length}</Label>
                    {naive.chunks.length === 0 && (
                      <p style={{ fontSize: 12.5, color: muted }}>None.</p>
                    )}
                    {naive.chunks.map((c) => (
                      <Chunk key={c.rank} c={c} />
                    ))}
                    {naive.chunks.length > 0 && (
                      <p style={{ fontSize: 11, color: muted, marginTop: 8 }}>
                        Naive RAG uses all retrieved chunks regardless of quality &mdash;
                        no relevance grading, no escalation capability.
                      </p>
                    )}
                  </Column>

                  {/* ── Agentic Column ── */}
                  <Column
                    title="Agentic RAG"
                    subtitle="Decompose \u2192 hybrid + RRF \u2192 grade \u2192 answer or escalate"
                    accent="var(--primary)"
                  >
                    {/* Pipeline flow visualization */}
                    <PipelineFlow agentic={agentic} grading={gradingMeta} />

                    {/* HITL Escalation Banner (enhanced) */}
                    {agentic.escalated && (
                      <HitlEscalationBanner agentic={agentic} grading={gradingMeta} />
                    )}

                    <Label>Answer</Label>
                    <Answer text={agentic.answer} muted={agentic.escalated} />

                    {nSub > 0 && (
                      <>
                        <Label>Sub-queries · {nSub}</Label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {agentic.sub_queries.map((q, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: 12,
                                color: "var(--foreground)",
                                background: "var(--muted)",
                                borderRadius: 6,
                                padding: "3px 9px",
                              }}
                            >
                              {q}
                            </span>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Relevant context with grade detail */}
                    <Label>
                      Relevant context · {agentic.relevant.length}
                      {agentic.relevant.length > 0 && (
                        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                          {" "} (grade &ge; {threshold})
                        </span>
                      )}
                    </Label>
                    {agentic.relevant.length === 0 && (
                      <p style={{ fontSize: 12.5, color: muted }}>
                        Nothing passed the relevance grader &mdash; escalated to human admin.
                      </p>
                    )}
                    {agentic.relevant.map((c) => (
                      <Chunk key={c.rank} c={c} threshold={threshold} showGradeDetail />
                    ))}

                    {/* Grading Rubric toggle */}
                    <GradingRubric grading={gradingMeta} />

                    {/* Graded candidates — all candidates with their grades visible */}
                    {gradedCandidates.length > 0 && (
                      <>
                        <button
                          onClick={() => setShowGradedCandidates((v) => !v)}
                          style={{
                            marginTop: 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 12,
                            fontWeight: 600,
                            color: agentic.escalated ? ESCALATE_COLOR : muted,
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <ChevronDown
                            size={14}
                            style={{
                              transform: showGradedCandidates ? "rotate(180deg)" : "none",
                              transition: "transform .15s",
                            }}
                          />
                          {showGradedCandidates ? "Hide" : "Show"} all graded candidates ({gradedCandidates.length})
                          {agentic.escalated && !showGradedCandidates && (
                            <span style={{ fontSize: 10.5, color: muted, fontWeight: 400 }}>
                              {" "}&mdash; see why each chunk failed
                            </span>
                          )}
                        </button>
                        {showGradedCandidates && (
                          <div style={{ marginTop: 4 }}>
                            <p style={{ margin: "0 0 6px", fontSize: 11, color: muted }}>
                              Every retrieved candidate with its LLM-assigned relevance grade.
                              Chunks &ge; {threshold} pass; below = filtered out.
                            </p>
                            {gradedCandidates.map((c) => (
                              <Chunk key={c.rank} c={c} threshold={threshold} showGradeDetail />
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Raw fused candidates (before grading) */}
                    {agentic.candidates?.length > 0 && (
                      <>
                        <button
                          onClick={() => setShowCandidates((v) => !v)}
                          style={{
                            marginTop: 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 12,
                            color: muted,
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <ChevronDown
                            size={14}
                            style={{
                              transform: showCandidates ? "rotate(180deg)" : "none",
                              transition: "transform .15s",
                            }}
                          />
                          {showCandidates ? "Hide" : "Show"} raw RRF candidates before grading (
                          {agentic.candidates.length})
                        </button>
                        {showCandidates &&
                          agentic.candidates.map((c) => <Chunk key={c.rank} c={c} />)}
                      </>
                    )}
                  </Column>
                </div>
              </>
            )}

            {!result && !loading && !error && (
              <Card style={{ marginTop: 16, padding: "40px 20px", textAlign: "center" }}>
                <p style={{ margin: 0, color: muted, fontSize: 13.5 }}>
                  Enter a question to run both systems side by side.
                </p>
              </Card>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
