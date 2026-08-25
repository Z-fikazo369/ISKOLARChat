import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { GraduationCap, Mail, Phone, ArrowLeft } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useTitle } from "../../hooks/useTitle";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.657 14.013 17.64 11.705 17.64 9.2z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>
);

export default function StudentSignup() {
  const navigate = useNavigate();
  useTitle("Student Sign Up");
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.endsWith(".edu") && !email.endsWith(".edu.ph")) {
      setError("Please use a valid .edu email address.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role: "student" },
        },
      });

      if (signupError) throw signupError;

      // Profile creation is handled by the on_auth_user_created DB trigger
      // (client-side inserts fail when email confirmation is enabled,
      // because there is no session yet).

      alert("Account created! You can now log in.");
      navigate("/student/login");
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
    },
    googleBtn: {
      width: "100%",
      padding: "13px",
      background: "#fff",
      color: "#1f1f1f",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      marginBottom: "12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      fontFamily: "inherit",
    },
    outlineBtn: {
      width: "100%",
      padding: "13px",
      background: "rgba(22, 163, 74, 0.06)",
      border: "1px solid rgba(22, 163, 74, 0.4)",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "600",
      color: "var(--primary)",
      cursor: "pointer",
      marginBottom: "12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      fontFamily: "inherit",
    },
    disabledBtn: {
      opacity: 0.4,
      cursor: "not-allowed",
    },
    divider: {
      textAlign: "center",
      color: "var(--muted-foreground)",
      margin: "4px 0 16px",
      fontSize: "12px",
    },
    input: {
      width: "100%",
      padding: "12px",
      background: "rgba(22, 163, 74, 0.05)",
      border: "1px solid rgba(22, 163, 74, 0.25)",
      borderRadius: "8px",
      color: "var(--foreground)",
      fontSize: "14px",
      fontFamily: "inherit",
      boxSizing: "border-box",
      outline: "none",
      marginBottom: "12px",
    },
    primaryBtn: {
      width: "100%",
      padding: "13px",
      background: "var(--primary)",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "700",
      cursor: "pointer",
      marginBottom: "12px",
      fontFamily: "inherit",
      transition: "opacity 0.2s",
    },
    footer: {
      textAlign: "center",
      fontSize: "14px",
      color: "var(--muted-foreground)",
      marginTop: "8px",
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
          <GraduationCap size={28} color="#16a34a" />
        </div>

        <div style={s.header}>
          <h1 style={s.title}>ISKOLARCHAT</h1>
          <p style={s.subtitle}>Create Student Account</p>
        </div>

        {error && <div style={s.error}>{error}</div>}

        {showEmailForm ? (
          <>
            <button
              style={{ ...s.outlineBtn, marginBottom: "16px" }}
              onClick={() => {
                setShowEmailForm(false);
                setEmail("");
                setPassword("");
                setConfirmPassword("");
                setError("");
              }}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <form onSubmit={handleEmailSignup}>
              <input
                type="email"
                placeholder="your.email@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={s.input}
                disabled={loading}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={s.input}
                disabled={loading}
              />
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ ...s.input, marginBottom: "16px" }}
                disabled={loading}
              />
              <button
                type="submit"
                style={{ ...s.primaryBtn, opacity: loading ? 0.7 : 1 }}
                disabled={loading}
              >
                {loading ? "Signing up..." : "Sign Up"}
              </button>
            </form>
          </>
        ) : (
          <>
            <button
              style={s.googleBtn}
              onClick={handleGoogleSignup}
              disabled={loading}
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <button
              style={{ ...s.outlineBtn, ...s.disabledBtn }}
              disabled
              title="Phone signup coming soon"
            >
              <Phone size={18} />
              Continue with Phone Number
            </button>

            <div style={s.divider}>OR</div>

            <button
              style={s.outlineBtn}
              onClick={() => setShowEmailForm(true)}
              disabled={loading}
            >
              <Mail size={18} />
              Sign up with EDU Email
            </button>
          </>
        )}

        <div style={s.footer}>
          Already have an account?{" "}
          <Link to="/student/login" style={s.link}>
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
