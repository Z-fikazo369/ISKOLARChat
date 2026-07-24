import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Shield, Mail, Lock, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useTitle } from "../../hooks/useTitle";

export default function AdminLogin() {
  const navigate = useNavigate();
  useTitle("Admin Login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();

      if (profile?.role !== "admin" && profile?.role !== "superadmin") {
        await supabase.auth.signOut();
        throw new Error("Only approved admin accounts can login.");
      }

      navigate("/admin/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const s = {
    page: {
      background: "var(--background)",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    },
    backBtn: {
      position: "absolute",
      top: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "none",
      border: "none",
      color: "var(--primary)",
      cursor: "pointer",
      fontSize: "14px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontFamily: "inherit",
    },
    card: {
      background: "rgba(22, 163, 74, 0.03)",
      border: "1px solid rgba(22, 163, 74, 0.2)",
      borderRadius: "16px",
      padding: "40px",
      maxWidth: "420px",
      width: "100%",
      backdropFilter: "blur(10px)",
    },
    iconCircle: {
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      background: "rgba(22, 163, 74, 0.15)",
      border: "1px solid rgba(22, 163, 74, 0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      margin: "0 auto 20px",
    },
    header: {
      textAlign: "center",
      marginBottom: "30px",
    },
    title: {
      fontSize: "28px",
      fontWeight: "800",
      color: "var(--primary)",
      margin: "0 0 6px",
      letterSpacing: "1px",
    },
    subtitle: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
    },
    error: {
      background: "rgba(239, 68, 68, 0.1)",
      border: "1px solid rgba(239, 68, 68, 0.3)",
      color: "#f87171",
      padding: "12px 14px",
      borderRadius: "8px",
      fontSize: "13px",
      marginBottom: "16px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    formGroup: {
      marginBottom: "16px",
    },
    label: {
      display: "block",
      fontSize: "11px",
      fontWeight: "700",
      color: "var(--primary)",
      marginBottom: "8px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    },
    inputWrap: {
      position: "relative",
      display: "flex",
      alignItems: "center",
    },
    inputIcon: {
      position: "absolute",
      left: "12px",
      color: "rgba(22, 163, 74, 0.6)",
      pointerEvents: "none",
    },
    input: {
      width: "100%",
      padding: "12px 12px 12px 38px",
      background: "rgba(22, 163, 74, 0.05)",
      border: "1px solid rgba(22, 163, 74, 0.25)",
      borderRadius: "8px",
      color: "var(--foreground)",
      fontSize: "14px",
      fontFamily: "inherit",
      boxSizing: "border-box",
      outline: "none",
    },
    btn: {
      width: "100%",
      padding: "13px",
      background: "var(--primary)",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "700",
      cursor: "pointer",
      marginTop: "8px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      transition: "opacity 0.2s",
    },
    warning: {
      background: "rgba(234, 179, 8, 0.08)",
      border: "1px solid rgba(234, 179, 8, 0.25)",
      color: "#fbbf24",
      padding: "12px 14px",
      borderRadius: "8px",
      fontSize: "13px",
      marginTop: "16px",
      lineHeight: "1.5",
    },
    footer: {
      textAlign: "center",
      fontSize: "13px",
      color: "var(--muted-foreground)",
      marginTop: "16px",
    },
    link: {
      color: "var(--primary)",
      textDecoration: "none",
      fontWeight: "600",
    },
  };

  return (
    <div style={s.page}>
      <button style={s.backBtn} onClick={() => navigate("/")}>
        ← Back to Home
      </button>

      <div style={s.card}>
        <div style={s.iconCircle}>
          <Shield size={28} color="#16a34a" />
        </div>

        <div style={s.header}>
          <h1 style={s.title}>ISKOLARCHAT</h1>
          <p style={s.subtitle}>Admin Login</p>
        </div>

        {error && (
          <div style={s.error}>
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={s.formGroup}>
            <label style={s.label}>Admin Email</label>
            <div style={s.inputWrap}>
              <Mail size={15} style={s.inputIcon} />
              <input
                type="email"
                style={s.input}
                placeholder="admin@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div style={s.formGroup}>
            <label style={s.label}>Password</label>
            <div style={s.inputWrap}>
              <Lock size={15} style={s.inputIcon} />
              <input
                type="password"
                style={s.input}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            <Shield size={16} />
            {loading ? "Logging in..." : "Login as Admin"}
          </button>
        </form>

        <div style={s.warning}>
          Only approved admin accounts can login. If you haven't been approved
          yet, please wait for super admin verification.
        </div>

        <div style={s.footer}>
          Need admin access?{" "}
          <Link to="/admin/apply" style={s.link}>
            Apply here
          </Link>
        </div>
      </div>
    </div>
  );
}
