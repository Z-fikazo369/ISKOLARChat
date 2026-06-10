import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import {
  Shield, LogOut, AlertCircle, UserCheck, Users,
  Eye, Trash2, Mail, Phone, Clock, CheckCircle, XCircle, Search,
} from "lucide-react";
import { useTitle } from "../../hooks/useTitle";
import ThemeToggle from "../../components/ThemeToggle";

export default function SuperAdminDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  useTitle("Super Admin Portal");

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setApplications(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleApprove = async (app) => {
    setActionLoading(true);
    try {
      const { error: updateError } = await supabase
        .from("admin_applications")
        .update({ status: "approved" })
        .eq("id", app.id);
      if (updateError) throw updateError;

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: app.user_id, email: app.email, role: "admin" });
      if (profileError) throw profileError;

      await fetchApplications();
      setSelected((prev) => (prev?.id === app.id ? { ...prev, status: "approved" } : prev));
    } catch (err) {
      alert("Error approving application: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (app) => {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("admin_applications")
        .update({ status: "rejected" })
        .eq("id", app.id);
      if (error) throw error;

      await fetchApplications();
      setSelected((prev) => (prev?.id === app.id ? { ...prev, status: "rejected" } : prev));
    } catch (err) {
      alert("Error rejecting application: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (app) => {
    if (!window.confirm(`Delete application from ${app.full_name}? This cannot be undone.`)) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from("admin_applications")
        .delete()
        .eq("id", app.id);
      if (error) throw error;

      setApplications((prev) => prev.filter((a) => a.id !== app.id));
      if (selected?.id === app.id) setSelected(null);
    } catch (err) {
      alert("Error deleting application: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const pending = applications.filter((a) => a.status === "pending");
  const approved = applications.filter((a) => a.status === "approved");

  const filtered =
    tab === "pending"
      ? pending
      : applications.filter((a) => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return (
            a.full_name?.toLowerCase().includes(q) ||
            a.email?.toLowerCase().includes(q) ||
            a.department?.toLowerCase().includes(q) ||
            a.position?.toLowerCase().includes(q)
          );
        });

  const formatDate = (d) => {
    if (!d) return "N/A";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const StatusBadge = ({ status }) => {
    const cfg = {
      pending: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", label: "Pending" },
      approved: { color: "#16a34a", bg: "rgba(22,163,74,0.12)", border: "rgba(22,163,74,0.3)", label: "Approved" },
      rejected: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", label: "Rejected" },
    }[status] || { color: "var(--muted-foreground)", bg: "transparent", border: "var(--muted-foreground)", label: status };

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

  const DetailPanel = ({ app }) => {
    const latest = applications.find((a) => a.id === app?.id) || app;

    if (!latest) {
      return (
        <div style={s.panel}>
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>
              <Eye size={22} color="#16a34a" />
            </div>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "var(--muted-2)" }}>
              Select an application to view details
            </p>
            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--muted-2)" }}>
              Click any application on the left
            </p>
          </div>
        </div>
      );
    }

    return (
      <div style={s.panel}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(22,163,74,0.1)" }}>
          <p style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#16a34a" }}>
            Application Details
          </p>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={s.detailGrid}>
            <Field label="Full Name" value={latest.full_name} />
            <Field label="Employee ID" value={latest.employee_id} />
            <Field label="Department" value={latest.department} />
            <Field label="Position" value={latest.position} />

            <div style={{ gridColumn: "1 / -1" }}>
              <span style={s.detailLabel}>Email</span>
              <span style={{ ...s.detailValue, display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                <Mail size={13} color="var(--muted-foreground)" />
                {latest.email || "—"}
              </span>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <span style={s.detailLabel}>Phone</span>
              <span style={{ ...s.detailValue, display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                <Phone size={13} color="var(--muted-foreground)" />
                {latest.phone}
              </span>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <span style={s.detailLabel}>Reason for Admin Access</span>
              <div style={s.reasonBox}>{latest.reason}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={s.detailLabel}>Applied At</span>
              <span style={{ ...s.detailValue, display: "flex", alignItems: "center", gap: "6px" }}>
                <Clock size={13} color="var(--muted-foreground)" />
                {formatDate(latest.created_at)}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={s.detailLabel}>Status</span>
              <StatusBadge status={latest.status} />
            </div>
          </div>

          <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border-soft)" }}>
            {latest.status === "pending" ? (
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  style={{ ...s.approveBtn, opacity: actionLoading ? 0.6 : 1 }}
                  onClick={() => handleApprove(latest)}
                  disabled={actionLoading}
                >
                  <CheckCircle size={15} />
                  {actionLoading ? "Processing..." : "Approve"}
                </button>
                <button
                  style={{ ...s.rejectBtn, opacity: actionLoading ? 0.6 : 1 }}
                  onClick={() => handleReject(latest)}
                  disabled={actionLoading}
                >
                  <XCircle size={15} />
                  {actionLoading ? "Processing..." : "Reject"}
                </button>
              </div>
            ) : (
              <button
                style={{ ...s.deleteBtn, opacity: actionLoading ? 0.6 : 1 }}
                onClick={() => handleDelete(latest)}
                disabled={actionLoading}
              >
                <Trash2 size={15} />
                Delete Application
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const Field = ({ label, value }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={s.detailLabel}>{label}</span>
      <span style={s.detailValue}>{value || "—"}</span>
    </div>
  );

  const statusAccent = (status) =>
    status === "approved" ? "#16a34a" : status === "rejected" ? "#ef4444" : "#f59e0b";

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
    main: { padding: "28px", maxWidth: "1400px", margin: "0 auto" },
    statsRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" },
    statCard: {
      background: "rgba(22,163,74,0.04)",
      border: "1px solid rgba(22,163,74,0.15)",
      borderRadius: "12px",
      padding: "20px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    statIcon: {
      width: "48px", height: "48px", borderRadius: "50%",
      background: "rgba(22,163,74,0.12)",
      border: "1px solid rgba(22,163,74,0.25)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    },
    tabs: { display: "flex", gap: "8px", marginBottom: "20px" },
    panel: {
      background: "rgba(22,163,74,0.03)",
      border: "1px solid rgba(22,163,74,0.12)",
      borderRadius: "12px",
      overflow: "hidden",
    },
    emptyState: { padding: "60px 24px", textAlign: "center", color: "var(--muted-foreground)" },
    emptyIcon: {
      width: "52px", height: "52px", borderRadius: "50%",
      background: "rgba(22,163,74,0.08)",
      border: "1px solid rgba(22,163,74,0.15)",
      display: "flex", alignItems: "center", justifyContent: "center",
      margin: "0 auto 12px",
    },
    detailGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
    detailLabel: {
      display: "block",
      fontSize: "10px",
      fontWeight: "700",
      color: "var(--muted-foreground)",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    },
    detailValue: { fontSize: "13px", color: "var(--foreground)", fontWeight: "500" },
    reasonBox: {
      background: "var(--input-bg)",
      border: "1px solid var(--border-soft)",
      borderRadius: "8px",
      padding: "12px",
      fontSize: "13px",
      color: "var(--text-secondary)",
      lineHeight: "1.6",
      marginTop: "4px",
    },
    approveBtn: {
      flex: 1,
      padding: "11px",
      background: "#16a34a",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "700",
      cursor: "pointer",
      fontFamily: "inherit",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
    },
    rejectBtn: {
      flex: 1,
      padding: "11px",
      background: "transparent",
      color: "#f87171",
      border: "1px solid rgba(239,68,68,0.4)",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "700",
      cursor: "pointer",
      fontFamily: "inherit",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
    },
    deleteBtn: {
      width: "100%",
      padding: "11px",
      background: "transparent",
      color: "#f87171",
      border: "1px solid rgba(239,68,68,0.4)",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "700",
      cursor: "pointer",
      fontFamily: "inherit",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
    },
    iconBtn: {
      background: "transparent",
      border: "none",
      padding: "4px",
      cursor: "pointer",
      borderRadius: "4px",
      display: "flex",
      lineHeight: 1,
    },
  };

  return (
    <div style={s.page}>
      {/* Navbar */}
      <nav style={s.nav}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={s.navIcon}>
            <Shield size={20} color="#16a34a" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: "15px", fontWeight: "800", color: "#16a34a", letterSpacing: "0.5px" }}>
              ISKOLARCHAT
            </span>
            <span style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "2px" }}>
              Super Admin Portal
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
        {/* Stats */}
        <div style={s.statsRow}>
          {[
            { label: "Pending Applications", value: pending.length, color: "#f59e0b", Icon: AlertCircle },
            { label: "Approved Admins", value: approved.length, color: "#16a34a", Icon: UserCheck },
            { label: "Total Applications", value: applications.length, color: "#16a34a", Icon: Users },
          ].map(({ label, value, color, Icon }) => (
            <div key={label} style={s.statCard}>
              <div>
                <div style={{ fontSize: "36px", fontWeight: "800", color, lineHeight: 1 }}>
                  {loading ? "—" : value}
                </div>
                <div style={{ fontSize: "13px", color: "var(--muted-foreground)", marginTop: "4px" }}>{label}</div>
              </div>
              <div style={s.statIcon}>
                <Icon size={22} color={color} />
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {[
            { key: "pending", label: "Pending", badge: pending.length },
            { key: "all", label: "All Applications", badge: null },
          ].map(({ key, label, badge }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => { setTab(key); setSelected(null); setSearch(""); }}
                style={{
                  padding: "8px 18px",
                  borderRadius: "20px",
                  border: active ? "none" : "1px solid rgba(22,163,74,0.3)",
                  background: active ? "#16a34a" : "transparent",
                  color: active ? "#fff" : "#16a34a",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {label}
                {badge > 0 && (
                  <span
                    style={{
                      background: active ? "rgba(255,255,255,0.25)" : "rgba(22,163,74,0.2)",
                      borderRadius: "10px",
                      padding: "1px 7px",
                      fontSize: "11px",
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Two-panel layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "start" }}>
          {/* Left: list */}
          <div style={s.panel}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(22,163,74,0.1)" }}>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "var(--foreground)" }}>
                {tab === "pending" ? "Admin Application Requests" : "All Applications"}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: "12px", color: "var(--muted-foreground)" }}>
                {tab === "pending"
                  ? "Click an application to review and take action"
                  : `${filtered.length} application${filtered.length !== 1 ? "s" : ""}`}
              </p>
            </div>

            {tab === "all" && (
              <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(22,163,74,0.1)" }}>
                <div style={{ position: "relative" }}>
                  <Search
                    size={15}
                    color="var(--muted-foreground)"
                    style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  />
                  <input
                    style={{
                      width: "100%",
                      padding: "10px 14px 10px 34px",
                      background: "rgba(22,163,74,0.06)",
                      border: "1px solid rgba(22,163,74,0.2)",
                      borderRadius: "8px",
                      color: "var(--foreground)",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                      outline: "none",
                    }}
                    placeholder="Search by name, email, department..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            )}

            {loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--muted-foreground)", fontSize: "13px" }}>
                Loading applications...
              </div>
            ) : filtered.length === 0 ? (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>
                  <Users size={22} color="#16a34a" />
                </div>
                <p style={{ margin: 0, fontSize: "13px" }}>
                  {tab === "pending" ? "No pending applications" : "No applications found"}
                </p>
              </div>
            ) : (
              filtered.map((app) => {
                const isActive = selected?.id === app.id;
                return (
                  <div
                    key={app.id}
                    onClick={() => setSelected(app)}
                    style={{
                      padding: "16px 20px",
                      borderBottom: "1px solid var(--border-soft)",
                      cursor: "pointer",
                      background: isActive ? "rgba(22,163,74,0.08)" : "transparent",
                      borderLeft: `3px solid ${statusAccent(app.status)}`,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "rgba(22,163,74,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: "var(--foreground)" }}>
                        {app.full_name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <StatusBadge status={app.status} />
                        {tab === "all" && (
                          <>
                            <button
                              style={s.iconBtn}
                              title="View details"
                              onClick={(e) => { e.stopPropagation(); setSelected(app); }}
                            >
                              <Eye size={15} color="var(--muted-foreground)" />
                            </button>
                            {app.status !== "pending" && (
                              <button
                                style={s.iconBtn}
                                title="Delete application"
                                onClick={(e) => { e.stopPropagation(); handleDelete(app); }}
                              >
                                <Trash2 size={15} color="#f87171" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "2px" }}>
                      {app.position} — {app.department}
                    </p>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "4px" }}>
                      {app.email || "No email saved"}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "11px",
                        fontWeight: "600",
                        color: statusAccent(app.status),
                      }}
                    >
                      Applied: {formatDate(app.created_at)}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {/* Right: detail */}
          <DetailPanel app={selected} />
        </div>
      </div>
    </div>
  );
}
