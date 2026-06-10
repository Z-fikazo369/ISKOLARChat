import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { apiFetch } from "../../lib/api";
import {
  FileText, Clock, Upload, Trash2, LogOut,
  User, Send, CheckCircle, AlertCircle, XCircle,
} from "lucide-react";
import { useTitle } from "../../hooks/useTitle";
import ThemeToggle from "../../components/ThemeToggle";

const formatSize = (bytes) => {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
};

const formatDateTime = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
};

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  useTitle("Admin Dashboard");

  const [tab, setTab] = useState("documents");
  const [documents, setDocuments] = useState([]);
  const [queries, setQueries] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [queriesLoading, setQueriesLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeQuery, setActiveQuery] = useState(null);
  const [answers, setAnswers] = useState({});
  const [sendingId, setSendingId] = useState(null);
  const fileInputRef = useRef(null);

  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true);
    const { data } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setDocuments(data);
    setDocsLoading(false);
  }, []);

  const fetchQueries = useCallback(async () => {
    setQueriesLoading(true);
    const { data } = await supabase
      .from("chat_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setQueries(data);
    setQueriesLoading(false);
  }, []);

  useEffect(() => {
    fetchDocuments();
    fetchQueries();
  }, [fetchDocuments, fetchQueries]);

  // Auto-refresh every 4s while any document is still processing,
  // so "Processing" flips to "Ready" without a manual reload.
  // (silent fetch — fetchDocuments() would flash the loading state)
  useEffect(() => {
    if (!documents.some((d) => d.status === "processing")) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setDocuments(data);
    }, 4000);
    return () => clearInterval(timer);
  }, [documents]);

  // Poll HITL queries every 8s so new escalations appear (and the badge
  // updates) without a manual refresh.
  useEffect(() => {
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("chat_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setQueries(data);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error(`"${file.name}" is not a PDF. Only PDF files are supported.`);
        }
        // sanitize: storage keys break on special characters
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${Date.now()}_${safeName}`;
        const { data: storageData, error: storageError } = await supabase.storage
          .from("documents")
          .upload(filePath, file);

        if (storageError) throw storageError;

        const { data: doc, error: insertError } = await supabase
          .from("documents")
          .insert({
            name: file.name,
            size: file.size,
            file_path: storageData.path,
            status: "processing",
            uploaded_by: user.id,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // queue the document for the ingestion pipeline (Phase 2)
        await apiFetch(`/api/documents/${doc.id}/ingest`, { method: "POST" });
      }
      await fetchDocuments();
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"? This also removes its chunks from the knowledge base.`)) return;
    try {
      // backend removes the storage file, Qdrant vectors, and the DB row
      await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const handleSendAnswer = async (query) => {
    const answer = answers[query.id]?.trim();
    if (!answer) return;
    setSendingId(query.id);
    try {
      // backend stores the answer AND re-ingests it into the knowledge base
      // (Phase 1 Step 4 — knowledge loop)
      await apiFetch(`/api/hitl/${query.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ answer }),
      });

      setQueries((prev) =>
        prev.map((q) =>
          q.id === query.id ? { ...q, status: "answered", admin_response: answer } : q
        )
      );
      setAnswers((prev) => ({ ...prev, [query.id]: "" }));
      setActiveQuery(null);
    } catch (err) {
      alert("Failed to send answer: " + err.message);
    } finally {
      setSendingId(null);
    }
  };

  const handleRejectQuery = async (query) => {
    if (!window.confirm("Reject this question? The student will not receive an answer and it won't be added to the knowledge base.")) return;
    setSendingId(query.id);
    try {
      await apiFetch(`/api/hitl/${query.id}/reject`, { method: "POST" });
      setQueries((prev) =>
        prev.map((q) => (q.id === query.id ? { ...q, status: "rejected" } : q))
      );
      setActiveQuery(null);
    } catch (err) {
      alert("Failed to reject: " + err.message);
    } finally {
      setSendingId(null);
    }
  };

  const handleDeleteQuery = async (query) => {
    if (!window.confirm("Delete this query permanently?")) return;
    try {
      await apiFetch(`/api/hitl/${query.id}`, { method: "DELETE" });
      setQueries((prev) => prev.filter((q) => q.id !== query.id));
      if (activeQuery === query.id) setActiveQuery(null);
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const pending = queries.filter((q) => q.status === "pending");
  const resolved = queries.filter((q) => q.status === "answered" || q.status === "rejected");

  // ─── styles ────────────────────────────────────────────────────────────────
  const s = {
    page: { background: "var(--background)", minHeight: "100vh", color: "var(--foreground)", fontFamily: "inherit" },
    nav: {
      background: "var(--nav-bg)",
      borderBottom: "1px solid rgba(22,163,74,0.15)",
      padding: "14px 28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 50,
      backdropFilter: "blur(10px)",
    },
    navIcon: {
      width: "38px", height: "38px", borderRadius: "50%",
      background: "rgba(22,163,74,0.15)",
      border: "1px solid rgba(22,163,74,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
    },
    logoutBtn: {
      background: "rgba(239,68,68,0.08)",
      border: "1px solid rgba(239,68,68,0.3)",
      borderRadius: "8px",
      color: "#f87171",
      fontSize: "14px",
      fontWeight: "600",
      padding: "9px 18px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontFamily: "inherit",
    },
    main: { padding: "28px", maxWidth: "1200px", margin: "0 auto" },
    tabs: { display: "flex", gap: "8px", marginBottom: "24px" },
    card: {
      background: "rgba(22,163,74,0.03)",
      border: "1px solid rgba(22,163,74,0.15)",
      borderRadius: "12px",
      marginBottom: "20px",
      overflow: "hidden",
    },
    cardPad: { padding: "20px 24px" },
    cardTitle: { fontSize: "15px", fontWeight: "700", color: "#16a34a", marginBottom: "4px" },
    cardSub: { fontSize: "13px", color: "var(--muted-foreground)" },
    dropzone: (active) => ({
      margin: "16px 0 0",
      border: `2px dashed ${active ? "rgba(22,163,74,0.7)" : "rgba(22,163,74,0.25)"}`,
      borderRadius: "10px",
      background: active ? "rgba(22,163,74,0.06)" : "var(--input-bg)",
      padding: "48px 24px",
      textAlign: "center",
      cursor: "pointer",
      transition: "all 0.2s",
    }),
    docRow: {
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "14px 20px",
      borderBottom: "1px solid var(--border-soft)",
    },
    docIcon: {
      width: "38px", height: "38px", borderRadius: "8px",
      background: "rgba(22,163,74,0.12)",
      border: "1px solid rgba(22,163,74,0.25)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    },
    deleteBtn: {
      background: "transparent",
      border: "none",
      cursor: "pointer",
      padding: "6px",
      borderRadius: "6px",
      display: "flex",
      marginLeft: "auto",
      flexShrink: 0,
    },
    queryCard: (status, active) => ({
      background: active ? "rgba(22,163,74,0.06)" : "rgba(22,163,74,0.02)",
      border: `1px solid ${status === "answered" ? "rgba(22,163,74,0.2)" : status === "rejected" ? "rgba(239,68,68,0.2)" : active ? "rgba(22,163,74,0.4)" : "rgba(245,158,11,0.25)"}`,
      borderLeft: `3px solid ${status === "answered" ? "#16a34a" : status === "rejected" ? "#ef4444" : "#f59e0b"}`,
      borderRadius: "10px",
      padding: "16px",
      marginBottom: "12px",
      cursor: status === "pending" ? "pointer" : "default",
      transition: "all 0.15s",
    }),
    textarea: {
      width: "100%",
      padding: "12px",
      background: "rgba(22,163,74,0.06)",
      border: "1px solid rgba(22,163,74,0.35)",
      borderRadius: "8px",
      color: "var(--foreground)",
      fontSize: "13px",
      fontFamily: "inherit",
      boxSizing: "border-box",
      resize: "vertical",
      minHeight: "80px",
      outline: "none",
      marginTop: "12px",
    },
    sendBtn: (disabled) => ({
      width: "100%",
      marginTop: "8px",
      padding: "10px",
      background: disabled ? "rgba(22,163,74,0.3)" : "#16a34a",
      border: "none",
      borderRadius: "8px",
      color: "#fff",
      fontSize: "13px",
      fontWeight: "700",
      cursor: disabled ? "not-allowed" : "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
      fontFamily: "inherit",
    }),
    answerBox: {
      background: "rgba(22,163,74,0.08)",
      border: "1px solid rgba(22,163,74,0.2)",
      borderRadius: "8px",
      padding: "10px 12px",
      marginTop: "10px",
      fontSize: "13px",
      color: "var(--on-accent)",
    },
    answerLabel: {
      fontSize: "11px",
      fontWeight: "700",
      color: "#16a34a",
      marginBottom: "4px",
    },
  };

  const StatusBadge = ({ status }) => {
    const cfg =
      status === "ready"
        ? { color: "#16a34a", bg: "rgba(22,163,74,0.12)", border: "rgba(22,163,74,0.3)", label: "Ready" }
        : status === "answered"
        ? { color: "#16a34a", bg: "rgba(22,163,74,0.12)", border: "rgba(22,163,74,0.3)", label: "Answered" }
        : status === "failed"
        ? { color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", label: "Failed" }
        : status === "rejected"
        ? { color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", label: "Rejected" }
        : { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", label: status === "processing" ? "Processing" : "Pending" };
    return (
      <span
        style={{
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          color: cfg.color,
          padding: "3px 10px",
          borderRadius: "20px",
          fontSize: "11px",
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          whiteSpace: "nowrap",
        }}
      >
        {cfg.label}
      </span>
    );
  };

  const TabBtn = ({ id, icon: Icon, label, badge }) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "9px 18px",
          borderRadius: "20px",
          border: active ? "none" : "1px solid rgba(22,163,74,0.3)",
          background: active ? "#16a34a" : "transparent",
          color: active ? "#fff" : "var(--muted-foreground)",
          fontSize: "13px",
          fontWeight: "600",
          cursor: "pointer",
          fontFamily: "inherit",
          position: "relative",
        }}
      >
        <Icon size={15} />
        {label}
        {badge > 0 && (
          <span
            style={{
              background: "#ef4444",
              color: "#fff",
              borderRadius: "10px",
              padding: "1px 6px",
              fontSize: "10px",
              fontWeight: "800",
              marginLeft: "2px",
            }}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={s.page}>
      {/* Navbar */}
      <nav style={s.nav}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={s.navIcon}>
            <User size={20} color="#16a34a" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: "15px", fontWeight: "800", color: "#16a34a", letterSpacing: "0.5px" }}>
              ISKOLARCHAT
            </span>
            <span style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "2px" }}>
              Admin Dashboard
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <ThemeToggle />
        <button
          style={s.logoutBtn}
          onClick={handleLogout}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239,68,68,0.18)";
            e.currentTarget.style.borderColor = "rgba(239,68,68,0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(239,68,68,0.08)";
            e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)";
          }}
        >
          <LogOut size={16} />
          Logout
        </button>
        </div>
      </nav>

      <div style={s.main}>
        {/* Tabs */}
        <div style={s.tabs}>
          <TabBtn id="documents" icon={FileText} label="Document Management" />
          <TabBtn id="queries" icon={Clock} label="Queries" badge={pending.length} />
        </div>

        {/* ── DOCUMENT MANAGEMENT ────────────────────────────────────────── */}
        {tab === "documents" && (
          <>
            {/* Upload zone */}
            <div style={s.card}>
              <div style={s.cardPad}>
                <p style={s.cardTitle}>Upload Documents for RAG</p>
                <p style={s.cardSub}>
                  Upload documents to be processed and stored in the vector database for student queries
                </p>

                <div
                  style={s.dropzone(dragOver || uploading)}
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleUpload(e.dataTransfer.files);
                  }}
                >
                  <Upload size={32} color="#16a34a" style={{ margin: "0 auto 12px", display: "block" }} />
                  <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: "600", color: "var(--foreground)" }}>
                    {uploading ? "Uploading..." : "Click to upload documents"}
                  </p>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
                    PDF files only
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf"
                    style={{ display: "none" }}
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                </div>
              </div>
            </div>

            {/* Documents list */}
            <div style={s.card}>
              <div style={{ ...s.cardPad, borderBottom: "1px solid rgba(22,163,74,0.1)" }}>
                <p style={s.cardTitle}>Uploaded Documents</p>
                <p style={s.cardSub}>
                  {docsLoading
                    ? "Loading..."
                    : `${documents.length} document${documents.length !== 1 ? "s" : ""} in the knowledge base`}
                </p>
              </div>

              {docsLoading ? (
                <div style={{ padding: "32px", textAlign: "center", color: "var(--muted-foreground)", fontSize: "13px" }}>
                  Loading documents...
                </div>
              ) : documents.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--muted-2)", fontSize: "13px" }}>
                  No documents uploaded yet. Upload files above to build the knowledge base.
                </div>
              ) : (
                documents.map((doc, i) => (
                  <div
                    key={doc.id}
                    style={{
                      ...s.docRow,
                      borderBottom: i < documents.length - 1 ? "1px solid var(--border-soft)" : "none",
                    }}
                  >
                    <div style={s.docIcon}>
                      <FileText size={18} color="#16a34a" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {doc.name}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted-foreground)" }}>
                        {formatSize(doc.size)} &bull; {formatDate(doc.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={doc.status} />
                    <button
                      style={s.deleteBtn}
                      onClick={() => handleDeleteDoc(doc)}
                      title="Delete document"
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <Trash2 size={16} color="#f87171" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── QUERIES ────────────────────────────────────────────────────── */}
        {tab === "queries" && (
          <>
            <div style={{ marginBottom: "20px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "700", color: "#16a34a" }}>
                Human-in-the-Loop Queries
              </p>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted-foreground)" }}>
                Student queries that require human intervention when the AI cannot find relevant information
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* Pending */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                  <AlertCircle size={16} color="#f59e0b" />
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#f59e0b" }}>
                    Pending Queries ({pending.length})
                  </span>
                </div>

                {queriesLoading ? (
                  <p style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>Loading...</p>
                ) : pending.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--muted-2)", fontSize: "13px", background: "rgba(22,163,74,0.02)", border: "1px solid rgba(22,163,74,0.08)", borderRadius: "10px" }}>
                    No pending queries
                  </div>
                ) : (
                  pending.map((q) => {
                    const isActive = activeQuery === q.id;
                    return (
                      <div
                        key={q.id}
                        style={s.queryCard("pending", isActive)}
                        onClick={() => !isActive && setActiveQuery(q.id)}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <User size={14} color="#16a34a" />
                            <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--foreground)" }}>
                              {q.student_name || q.student_email || "Student"}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <StatusBadge status="pending" />
                            <button
                              style={s.deleteBtn}
                              title="Delete query"
                              onClick={(e) => { e.stopPropagation(); handleDeleteQuery(q); }}
                            >
                              <Trash2 size={14} color="#f87171" />
                            </button>
                          </div>
                        </div>
                        <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                          {q.question}
                        </p>
                        <p style={{ margin: 0, fontSize: "11px", color: "var(--muted-foreground)" }}>
                          {formatDateTime(q.created_at)}
                        </p>

                        {isActive && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <textarea
                              style={s.textarea}
                              placeholder="Type your answer here..."
                              value={answers[q.id] || ""}
                              onChange={(e) =>
                                setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                              }
                              autoFocus
                            />
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                style={{ ...s.sendBtn(!answers[q.id]?.trim() || sendingId === q.id), flex: 2 }}
                                disabled={!answers[q.id]?.trim() || sendingId === q.id}
                                onClick={() => handleSendAnswer(q)}
                              >
                                <Send size={14} />
                                {sendingId === q.id ? "Sending..." : "Send Answer"}
                              </button>
                              <button
                                style={{
                                  flex: 1,
                                  marginTop: "8px",
                                  padding: "10px",
                                  background: "transparent",
                                  border: "1px solid rgba(239,68,68,0.4)",
                                  borderRadius: "8px",
                                  color: "#f87171",
                                  fontSize: "13px",
                                  fontWeight: "700",
                                  cursor: sendingId === q.id ? "not-allowed" : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: "6px",
                                  fontFamily: "inherit",
                                }}
                                disabled={sendingId === q.id}
                                onClick={() => handleRejectQuery(q)}
                                title="Dismiss without answering (spam / out of scope)"
                              >
                                <XCircle size={14} />
                                Reject
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Resolved (answered + rejected) */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                  <CheckCircle size={16} color="#16a34a" />
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#16a34a" }}>
                    Resolved Queries ({resolved.length})
                  </span>
                </div>

                {queriesLoading ? (
                  <p style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>Loading...</p>
                ) : resolved.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--muted-2)", fontSize: "13px", background: "rgba(22,163,74,0.02)", border: "1px solid rgba(22,163,74,0.08)", borderRadius: "10px" }}>
                    No resolved queries yet
                  </div>
                ) : (
                  resolved.map((q) => (
                    <div key={q.id} style={s.queryCard(q.status, false)}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <User size={14} color="#16a34a" />
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--foreground)" }}>
                            {q.student_name || q.student_email || "Student"}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <StatusBadge status={q.status} />
                          <button
                            style={s.deleteBtn}
                            title="Delete query"
                            onClick={() => handleDeleteQuery(q)}
                          >
                            <Trash2 size={14} color="#f87171" />
                          </button>
                        </div>
                      </div>
                      <p style={{ margin: "0 0 8px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                        {q.question}
                      </p>
                      {q.admin_response && (
                        <div style={s.answerBox}>
                          <p style={s.answerLabel}>Your Answer:</p>
                          <p style={{ margin: 0, lineHeight: "1.5" }}>{q.admin_response}</p>
                        </div>
                      )}
                      <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--muted-foreground)" }}>
                        {formatDateTime(q.created_at)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
