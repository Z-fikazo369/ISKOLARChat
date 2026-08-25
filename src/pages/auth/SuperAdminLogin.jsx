import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Mail, Lock, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useTitle } from "../../hooks/useTitle";

export default function SuperAdminLogin() {
  const navigate = useNavigate();
  useTitle("Super Admin Login");
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

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();

      // A transient query failure is NOT proof the account isn't a superadmin —
      // don't sign the user out for it.
      if (profileError) {
        throw new Error("Couldn't verify your account — please try again.");
      }

      if (profile?.role !== "superadmin") {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("Restricted access for system administrators only.");
      }

      navigate("/superadmin/dashboard");
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
      transition: "border-color 0.2s",
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
      background: "rgba(22, 163, 74, 0.06)",
      border: "1px solid rgba(22, 163, 74, 0.15)",
      color: "var(--muted-foreground)",
      padding: "10px 14px",
      borderRadius: "8px",
      fontSize: "12px",
      marginTop: "16px",
      textAlign: "center",
      lineHeight: "1.5",
    },
    backLink: {
      display: "block",
      textAlign: "center",
      marginTop: "20px",
      color: "var(--muted-foreground)",
      fontSize: "13px",
      cursor: "pointer",
      background: "none",
      border: "none",
      fontFamily: "inherit",
      textDecoration: "underline",
    },
    footer: {
      marginTop: "24px",
      textAlign: "center",
      fontSize: "11px",
      color: "rgba(156, 163, 175, 0.5)",
      maxWidth: "360px",
    },
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.iconCircle}>
          <Shield size={28} color="#16a34a" />
        </div>

        <div style={s.header}>
          <h1 style={s.title}>ISKOLARCHAT</h1>
          <p style={s.subtitle}>System Administration Portal</p>
        </div>

        {error && (
          <div style={s.error}>
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={s.formGroup}>
            <label style={s.label}>Super Admin Email</label>
            <div style={s.inputWrap}>
              <Mail size={15} style={s.inputIcon} />
              <input
                type="email"
                style={s.input}
                placeholder="superadmin@iskolarchat.com"
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
                placeholder="••••••••"
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
            {loading ? "Verifying..." : "Access System"}
          </button>
        </form>

        <div style={s.warning}>
          Restricted access for system administrators only.
          <br />
          All access attempts are logged.
        </div>

        <button style={s.backLink} onClick={() => navigate("/")}>
          Back to Home
        </button>
      </div>

      <p style={s.footer}>
        This portal is for authorized system administrators only. All access
        attempts are logged.
      </p>
    </div>
  );
}
