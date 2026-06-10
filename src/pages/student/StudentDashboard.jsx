import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { apiFetch, apiUpload } from "../../lib/api";
import {
  Plus, Send, Paperclip, MessageSquare, LogOut,
  GraduationCap, X, ChevronDown, BookOpen, AlertCircle,
  Trash2, Menu, ChevronLeft, Check,
} from "lucide-react";

const MODELS = {
  flash: { label: "Flash", desc: "Fastest replies", icon: "⚡" },
  pro: { label: "Pro", desc: "Smartest answers", icon: "🧠" },
  r1: { label: "R1", desc: "Deep step-by-step reasoning", icon: "🔬" },
};
const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "Max" },
];
import { useTitle } from "../../hooks/useTitle";
import ThemeToggle from "../../components/ThemeToggle";

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // "draft" = chat that exists only locally; a conversations row is created
  // in Supabase on its first message, then the draft takes the real UUID.
  const DRAFT_ID = "draft";
  const [chats, setChats] = useState([
    { id: DRAFT_ID, title: "New Chat", messages: [] },
  ]);
  const [currentChatId, setCurrentChatId] = useState(DRAFT_ID);

  // Load saved conversations (with messages) on mount
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: convos, error } = await supabase
        .from("conversations")
        .select("id, title, created_at, messages(id, role, content, sources, escalated, created_at)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error || !convos) return; // table missing or offline — stay local-only
      const loaded = convos.map((c) => ({
        id: c.id,
        title: c.title,
        messages: (c.messages || [])
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sources: m.sources || [],
            escalated: m.escalated,
          })),
      }));
      setChats([{ id: DRAFT_ID, title: "New Chat", messages: [] }, ...loaded]);
    })();
  }, [user]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // AI model preferences (persisted per browser)
  const [modelVariant, setModelVariant] = useState(
    () => localStorage.getItem("ai_model") || "flash"
  );
  const [reasoningEffort, setReasoningEffort] = useState(
    () => localStorage.getItem("ai_effort") || "low"
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef(null);

  // close the model menu when clicking anywhere else
  useEffect(() => {
    if (!modelMenuOpen) return;
    const close = (e) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [modelMenuOpen]);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const currentChat = chats.find((c) => c.id === currentChatId);
  const messages = currentChat?.messages || [];

  useTitle(currentChat?.title ? currentChat.title : "Student Dashboard");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleNewChat = () => {
    // reuse the existing empty draft instead of stacking empty chats
    if (!chats.some((c) => c.id === DRAFT_ID)) {
      setChats((prev) => [{ id: DRAFT_ID, title: "New Chat", messages: [] }, ...prev]);
    }
    setCurrentChatId(DRAFT_ID);
    setInput("");
    setAttachedFile(null);
  };

  const handleDeleteChat = async (chat, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return;
    if (chat.id !== DRAFT_ID) {
      // messages are removed too (ON DELETE CASCADE on conversation_id)
      const { error } = await supabase.from("conversations").delete().eq("id", chat.id);
      if (error) {
        alert("Failed to delete chat: " + error.message);
        return;
      }
    }
    const remaining = chats.filter((c) => c.id !== chat.id);
    setChats(remaining.length ? remaining : [{ id: DRAFT_ID, title: "New Chat", messages: [] }]);
    if (currentChatId === chat.id) {
      setCurrentChatId(remaining[0]?.id ?? DRAFT_ID);
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !attachedFile) return;

    const userInput = input.trim();
    const fileToSend = attachedFile;
    const fileName = attachedFile ? attachedFile.name : null;
    setInput("");
    setAttachedFile(null);
    setLoading(true);

    const chat = chats.find((c) => c.id === currentChatId);
    const isFirstMessage = (chat?.messages.length ?? 0) === 0;
    const title = isFirstMessage
      ? (userInput.slice(0, 42) || fileName || "New Chat")
      : chat.title;

    // Persist the conversation on first message (draft → real DB row)
    let chatId = currentChatId;
    if (chatId === DRAFT_ID) {
      const { data: convo } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title })
        .select()
        .single();
      if (convo) {
        chatId = convo.id;
        setChats((prev) =>
          prev.map((c) => (c.id === DRAFT_ID ? { ...c, id: convo.id } : c))
        );
        setCurrentChatId(convo.id);
      }
    }

    const userMsg = { id: Date.now(), role: "user", content: userInput, file: fileName };
    setChats((prev) =>
      prev.map((c) =>
        c.id !== chatId ? c : { ...c, title, messages: [...c.messages, userMsg] }
      )
    );
    if (chatId !== DRAFT_ID) {
      supabase
        .from("messages")
        .insert({ conversation_id: chatId, role: "user", content: userInput })
        .then(() => {});
    }

    let aiMsg;
    try {
      let res;
      if (fileToSend) {
        // attached file = one-off document Q&A (summarize/explain),
        // separate from the knowledge-base RAG flow
        const fd = new FormData();
        fd.append("question", userInput);
        fd.append("file", fileToSend);
        res = await apiUpload("/api/chat/file", fd);
      } else {
        res = await apiFetch("/api/chat", {
          method: "POST",
          body: JSON.stringify({
            question: userInput,
            model_variant: modelVariant,
            reasoning_effort: reasoningEffort,
          }),
        });
      }
      aiMsg = {
        id: Date.now() + 1,
        role: "assistant",
        content: res.answer,
        sources: res.sources || [],
        escalated: res.escalated,
      };
      if (chatId !== DRAFT_ID) {
        supabase
          .from("messages")
          .insert({
            conversation_id: chatId,
            role: "assistant",
            content: res.answer,
            sources: res.sources || [],
            escalated: res.escalated,
          })
          .then(() => {});
      }
    } catch (err) {
      // transient errors are shown but not saved into history;
      // backend sends useful messages (e.g. unsupported file type)
      aiMsg = {
        id: Date.now() + 1,
        role: "assistant",
        content: err.message && !err.message.startsWith("Request failed")
          ? err.message
          : "Sorry, I couldn't reach the AI service. Please try again in a moment.",
        error: true,
      };
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id !== chatId ? c : { ...c, messages: [...c.messages, aiMsg] }
      )
    );
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const initial = user?.email?.charAt(0).toUpperCase() || "S";
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Student";

  // ─── Styles ───────────────────────────────────────────────
  const s = {
    root: {
      display: "flex",
      height: "100vh",
      background: "var(--background)",
      overflow: "hidden",
      fontFamily: "inherit",
    },

    // Sidebar
    sidebar: {
      width: "272px",
      minWidth: "272px",
      background: "rgba(22, 163, 74, 0.04)",
      borderRight: "1px solid rgba(22, 163, 74, 0.12)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    sidebarHeader: {
      padding: "18px 16px 12px",
      borderBottom: "1px solid rgba(22, 163, 74, 0.1)",
    },
    brandName: {
      fontSize: "15px",
      fontWeight: "800",
      color: "#16a34a",
      letterSpacing: "1px",
      marginBottom: "12px",
    },
    newChatBtn: {
      width: "100%",
      padding: "10px 14px",
      background: "#16a34a",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "700",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      transition: "background 0.2s",
      fontFamily: "inherit",
    },
    chatList: {
      flex: 1,
      overflowY: "auto",
      padding: "8px",
    },
    chatItem: {
      padding: "10px 12px",
      borderRadius: "8px",
      cursor: "pointer",
      marginBottom: "2px",
      transition: "background 0.15s",
    },
    chatItemActive: {
      background: "rgba(22, 163, 74, 0.15)",
      border: "1px solid rgba(22, 163, 74, 0.2)",
    },
    chatItemInactive: {
      background: "transparent",
      border: "1px solid transparent",
    },
    chatItemTitle: {
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      marginBottom: "2px",
    },
    chatItemSub: {
      fontSize: "11px",
      color: "var(--muted-foreground)",
    },
    sidebarFooter: {
      padding: "12px",
      borderTop: "1px solid rgba(22, 163, 74, 0.1)",
    },
    userRow: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "8px",
      borderRadius: "8px",
      marginBottom: "8px",
    },
    avatar: {
      width: "34px",
      height: "34px",
      borderRadius: "50%",
      background: "rgba(22, 163, 74, 0.2)",
      border: "1px solid rgba(22, 163, 74, 0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "14px",
      fontWeight: "700",
      color: "#16a34a",
      flexShrink: 0,
    },
    userInfo: {
      overflow: "hidden",
    },
    userName: {
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    userEmail: {
      fontSize: "11px",
      color: "var(--muted-foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    logoutBtn: {
      width: "100%",
      padding: "9px 14px",
      background: "rgba(239, 68, 68, 0.08)",
      border: "1px solid rgba(239, 68, 68, 0.3)",
      borderRadius: "8px",
      color: "#f87171",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      transition: "background 0.2s",
      fontFamily: "inherit",
    },

    // Main
    main: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: "var(--background)",
    },
    mainHeader: {
      padding: "16px 24px",
      borderBottom: "1px solid rgba(22, 163, 74, 0.08)",
      fontSize: "14px",
      fontWeight: "600",
      color: "var(--foreground)",
    },
    messagesArea: {
      flex: 1,
      overflowY: "auto",
      padding: "24px",
      display: "flex",
      flexDirection: "column",
    },

    // Welcome screen
    welcome: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "40px",
    },
    welcomeIcon: {
      width: "72px",
      height: "72px",
      borderRadius: "50%",
      background: "rgba(22, 163, 74, 0.15)",
      border: "1px solid rgba(22, 163, 74, 0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: "24px",
    },
    welcomeTitle: {
      fontSize: "22px",
      fontWeight: "700",
      color: "var(--foreground)",
      marginBottom: "10px",
    },
    welcomeDesc: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      lineHeight: "1.7",
      maxWidth: "380px",
    },

    // Messages
    msgRow: {
      display: "flex",
      marginBottom: "16px",
    },
    msgUser: {
      justifyContent: "flex-end",
    },
    msgAi: {
      justifyContent: "flex-start",
    },
    bubble: {
      maxWidth: "72%",
      padding: "12px 16px",
      borderRadius: "12px",
      fontSize: "14px",
      lineHeight: "1.6",
    },
    bubbleUser: {
      background: "rgba(22, 163, 74, 0.18)",
      border: "1px solid rgba(22, 163, 74, 0.3)",
      color: "var(--foreground)",
      borderBottomRightRadius: "4px",
    },
    bubbleAi: {
      background: "var(--surface)",
      border: "1px solid var(--border-soft)",
      color: "var(--foreground)",
      borderBottomLeftRadius: "4px",
    },
    filePill: {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      background: "rgba(22,163,74,0.1)",
      border: "1px solid rgba(22,163,74,0.25)",
      borderRadius: "6px",
      padding: "4px 10px",
      fontSize: "12px",
      color: "#16a34a",
      marginBottom: "6px",
    },

    // Typing indicator
    typingDot: {
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      background: "#16a34a",
      display: "inline-block",
      margin: "0 2px",
      animation: "bounce 1.2s infinite",
    },

    // Input bar
    inputBar: {
      padding: "16px 24px 20px",
      borderTop: "1px solid rgba(22, 163, 74, 0.08)",
    },
    attachedFilePill: {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      background: "rgba(22,163,74,0.1)",
      border: "1px solid rgba(22,163,74,0.25)",
      borderRadius: "6px",
      padding: "5px 10px",
      fontSize: "12px",
      color: "#16a34a",
      marginBottom: "10px",
    },
    inputWrap: {
      display: "flex",
      alignItems: "flex-end",
      background: "var(--surface)",
      border: "1px solid rgba(22, 163, 74, 0.2)",
      borderRadius: "12px",
      padding: "8px 8px 8px 14px",
      gap: "8px",
      transition: "border-color 0.2s",
    },
    attachBtn: {
      background: "none",
      border: "none",
      color: "var(--muted-foreground)",
      cursor: "pointer",
      padding: "6px",
      borderRadius: "6px",
      display: "flex",
      alignItems: "center",
      transition: "color 0.2s",
      flexShrink: 0,
    },
    textarea: {
      flex: 1,
      background: "none",
      border: "none",
      outline: "none",
      color: "var(--foreground)",
      fontSize: "14px",
      lineHeight: "1.5",
      resize: "none",
      maxHeight: "140px",
      minHeight: "22px",
      fontFamily: "inherit",
      padding: "4px 0",
    },
    sendBtn: {
      width: "36px",
      height: "36px",
      borderRadius: "8px",
      background: "#16a34a",
      border: "none",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      transition: "opacity 0.2s",
    },
    inputHint: {
      textAlign: "center",
      fontSize: "11px",
      color: "var(--muted-2)",
      marginTop: "10px",
    },
  };

  return (
    <div style={s.root}>
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(22,163,74,0.2); border-radius: 2px; }
        .md-body p { margin: 0 0 10px; }
        .md-body p:last-child { margin-bottom: 0; }
        .md-body ul, .md-body ol { margin: 6px 0 10px; padding-left: 22px; }
        .md-body li { margin-bottom: 5px; }
        .md-body strong { color: var(--primary-soft); font-weight: 700; }
        .md-body h1, .md-body h2, .md-body h3 { font-size: 15px; color: var(--primary-soft); margin: 12px 0 6px; }
        .md-body code { background: rgba(22,163,74,0.12); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
      `}</style>

      {/* ── Sidebar ── */}
      {sidebarOpen && (
      <aside style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ ...s.brandName, marginBottom: 0 }}>ISKOLARCHAT</div>
            <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <ThemeToggle style={{ background: "none", border: "none", padding: "5px" }} />
            <button
              onClick={() => setSidebarOpen(false)}
              title="Hide chat history"
              style={{
                background: "none",
                border: "none",
                color: "var(--muted-foreground)",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "6px",
                display: "flex",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#16a34a")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
            >
              <ChevronLeft size={18} />
            </button>
            </div>
          </div>
          <button
            style={s.newChatBtn}
            onClick={handleNewChat}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#15803d")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#16a34a")}
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>

        <div style={s.chatList}>
          {chats.map((chat) => {
            const isActive = chat.id === currentChatId;
            return (
              <div
                key={chat.id}
                style={{
                  ...s.chatItem,
                  ...(isActive ? s.chatItemActive : s.chatItemInactive),
                }}
                onClick={() => setCurrentChatId(chat.id)}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "rgba(22,163,74,0.07)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.chatItemTitle}>{chat.title}</div>
                    <div style={s.chatItemSub}>
                      {chat.messages.length} message{chat.messages.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteChat(chat, e)}
                    title="Delete chat"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px",
                      borderRadius: "5px",
                      display: "flex",
                      color: "var(--muted-2)",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-2)")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={s.sidebarFooter}>
          <div style={s.userRow}>
            <div style={s.avatar}>{initial}</div>
            <div style={s.userInfo}>
              <div style={s.userName}>{displayName}</div>
              <div style={s.userEmail}>{user?.email}</div>
            </div>
          </div>
          <button
            style={s.logoutBtn}
            onClick={handleLogout}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.16)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.08)")}
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </aside>
      )}

      {/* ── Main ── */}
      <main style={s.main}>
        <div style={{ ...s.mainHeader, display: "flex", alignItems: "center", gap: "10px" }}>
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Show chat history"
              style={{
                background: "none",
                border: "none",
                color: "#16a34a",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "6px",
                display: "flex",
              }}
            >
              <Menu size={18} />
            </button>
          )}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentChat?.title}
          </span>
        </div>

        <div style={s.messagesArea}>
          {messages.length === 0 && !loading ? (
            <div style={s.welcome}>
              <div style={s.welcomeIcon}>
                <MessageSquare size={32} color="#16a34a" />
              </div>
              <h2 style={s.welcomeTitle}>Welcome to ISKOLARCHAT!</h2>
              <p style={s.welcomeDesc}>
                Your intelligent academic assistant powered by AI. Ask questions,
                upload documents, and get instant help with your studies.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    ...s.msgRow,
                    ...(msg.role === "user" ? s.msgUser : s.msgAi),
                  }}
                >
                  <div
                    style={{
                      ...s.bubble,
                      ...(msg.role === "user" ? s.bubbleUser : s.bubbleAi),
                    }}
                  >
                    {msg.file && (
                      <div style={s.filePill}>
                        <Paperclip size={11} />
                        {msg.file}
                      </div>
                    )}
                    {msg.file && <br />}
                    {msg.role === "assistant" ? (
                      <div className="md-body">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                    {msg.escalated && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "10px", fontSize: "12px", color: "#f59e0b" }}>
                        <AlertCircle size={13} />
                        Forwarded to admin staff for a verified answer
                      </div>
                    )}
                    {msg.sources?.length > 0 && (
                      <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px solid rgba(22,163,74,0.15)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "700", color: "#16a34a", marginBottom: "4px" }}>
                          <BookOpen size={12} />
                          References
                        </div>
                        {msg.sources.map((src, i) => (
                          <div key={i} style={{ fontSize: "11px", color: "var(--muted-foreground)", marginBottom: "2px" }}>
                            [{i + 1}] {src.document_name}
                            {src.page ? ` — p. ${src.page}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ ...s.msgRow, ...s.msgAi }}>
                  <div style={{ ...s.bubble, ...s.bubbleAi, padding: "14px 18px" }}>
                    <span style={{ ...s.typingDot, animationDelay: "0s" }} />
                    <span style={{ ...s.typingDot, animationDelay: "0.2s" }} />
                    <span style={{ ...s.typingDot, animationDelay: "0.4s" }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input bar */}
        <div style={s.inputBar}>
          {attachedFile && (
            <div style={s.attachedFilePill}>
              <Paperclip size={11} />
              {attachedFile.name}
              <button
                onClick={() => setAttachedFile(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#16a34a",
                  padding: "0 0 0 4px",
                  display: "flex",
                }}
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div style={{ ...s.inputWrap, flexDirection: "column", alignItems: "stretch", gap: "6px", padding: "12px 14px 10px" }}>
            <textarea
              ref={textareaRef}
              style={{ ...s.textarea, width: "100%" }}
              placeholder="Ask me anything about your studies..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
              }}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={1}
            />

            {/* bottom controls row — Claude-style */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                style={s.attachBtn}
                onClick={() => fileInputRef.current?.click()}
                title="Attach file (PDF, DOCX, TXT, or image)"
                onMouseEnter={(e) => (e.currentTarget.style.color = "#16a34a")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
              >
                <Paperclip size={17} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setAttachedFile(e.target.files?.[0] || null)}
              />

              {/* model + thinking picker */}
              <div ref={modelMenuRef} style={{ position: "relative", marginLeft: "auto" }}>
                <button
                  onClick={() => setModelMenuOpen((o) => !o)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: modelMenuOpen ? "var(--surface)" : "transparent",
                    border: "none",
                    color: "var(--muted-foreground)",
                    fontSize: "12.5px",
                    fontWeight: "600",
                    padding: "7px 10px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#16a34a")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
                >
                  {MODELS[modelVariant].icon} {MODELS[modelVariant].label}
                  {reasoningEffort !== "low" &&
                    ` · ${EFFORTS.find((ef) => ef.value === reasoningEffort)?.label} thinking`}
                  <ChevronDown size={13} style={{ transform: modelMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>

                {modelMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 10px)",
                      right: 0,
                      width: "264px",
                      background: "var(--card)",
                      border: "1px solid rgba(22,163,74,0.25)",
                      borderRadius: "14px",
                      boxShadow: "0 14px 44px rgba(0,0,0,0.35)",
                      padding: "8px",
                      zIndex: 100,
                    }}
                    className="anim-fade-up"
                  >
                    <div style={{ fontSize: "10.5px", fontWeight: "700", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.6px", padding: "6px 10px 4px" }}>
                      Model
                    </div>
                    {Object.entries(MODELS).map(([key, m]) => (
                      <button
                        key={key}
                        onClick={() => {
                          setModelVariant(key);
                          localStorage.setItem("ai_model", key);
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "9px 10px",
                          borderRadius: "9px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "inherit",
                          color: "var(--foreground)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{ fontSize: "15px" }}>{m.icon}</span>
                        <span style={{ flex: 1 }}>
                          <div style={{ fontSize: "13px", fontWeight: "600" }}>{m.label}</div>
                          <div style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>{m.desc}</div>
                        </span>
                        {modelVariant === key && <Check size={15} color="#16a34a" />}
                      </button>
                    ))}

                    <div style={{ height: "1px", background: "var(--border-soft)", margin: "6px 4px" }} />

                    <div style={{ fontSize: "10.5px", fontWeight: "700", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.6px", padding: "6px 10px 6px" }}>
                      Thinking effort
                    </div>
                    <div style={{ display: "flex", gap: "5px", padding: "0 6px 6px" }}>
                      {EFFORTS.map((ef) => {
                        const active = reasoningEffort === ef.value;
                        return (
                          <button
                            key={ef.value}
                            onClick={() => {
                              setReasoningEffort(ef.value);
                              localStorage.setItem("ai_effort", ef.value);
                            }}
                            style={{
                              flex: 1,
                              padding: "8px 0",
                              borderRadius: "8px",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              border: "none",
                              background: active ? "var(--primary)" : "var(--surface)",
                              color: active ? "#fff" : "var(--muted-foreground)",
                              transition: "all 0.2s",
                            }}
                          >
                            {ef.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button
                style={{
                  ...s.sendBtn,
                  opacity: (!input.trim() && !attachedFile) || loading ? 0.4 : 1,
                  cursor: (!input.trim() && !attachedFile) || loading ? "not-allowed" : "pointer",
                }}
                onClick={handleSend}
                disabled={(!input.trim() && !attachedFile) || loading}
              >
                <Send size={16} color="#fff" />
              </button>
            </div>
          </div>

          <div style={s.inputHint}>
            Upload files to enhance your queries with document context
          </div>
        </div>
      </main>
    </div>
  );
}
