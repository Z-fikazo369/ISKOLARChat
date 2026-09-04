import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useTitle } from "../../hooks/useTitle";

export default function AuthCallback() {
  useTitle("Setting up...");
  const navigate = useNavigate();
  const { user, loading, refreshRole } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    // OAuth failures (e.g. a non-.edu Google account rejected by the DB
    // trigger) redirect back here with ?error=... query params instead of a
    // session. Surface them instead of spinning forever.
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      setError(oauthError);
      return;
    }

    if (loading) return;
    if (!user) {
      navigate("/");
      return;
    }

    let cancelled = false;

    const handleCallback = async () => {
      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;

        if (!profile) {
          // Fallback if the DB trigger didn't run; role is always 'student' —
          // user_metadata is client-controlled and must not decide roles.
          const { error: insertError } = await supabase.from("profiles").insert({
            id: user.id,
            email: user.email,
            role: "student",
          });
          if (insertError) throw insertError;
          await refreshRole(user.id);
          navigate("/student/dashboard");
        } else if (profile.role === "student") {
          navigate("/student/dashboard");
        } else if (profile.role === "admin" || profile.role === "superadmin") {
          navigate("/admin/dashboard");
        } else {
          navigate("/");
        }
      } catch (err) {
        // A failed profiles read used to be silently dropped here, leaving
        // the user on this spinner forever. Show a real error instead.
        if (!cancelled) {
          setError(err.message || "We couldn't finish setting up your account.");
        }
      }
    };

    handleCallback();
    return () => {
      cancelled = true;
    };
    // refreshRole is intentionally not a dependency: it is recreated on every
    // AuthContext render, and its closure is safe to call stale (it only uses
    // stable setters plus the explicitly-passed id).
  }, [user, loading, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => {
    // Strip any ?error=... params from a failed OAuth redirect first, so the
    // reload restarts the flow cleanly instead of re-displaying the error.
    window.location.replace(window.location.pathname);
  };

  if (error) {
    return (
      <div
        style={{
          background: "var(--background)",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "20px",
        }}
      >
        <p
          style={{
            color: "#f87171",
            fontSize: "15px",
            maxWidth: "420px",
            textAlign: "center",
            lineHeight: "1.5",
          }}
        >
          {error}
        </p>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={retry}
            style={{
              padding: "10px 20px",
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "700",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => navigate("/")}
            style={{
              padding: "10px 20px",
              background: "transparent",
              color: "var(--primary)",
              border: "1px solid rgba(22, 163, 74, 0.4)",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--background)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
      }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          border: "3px solid rgba(22, 163, 74, 0.2)",
          borderTop: "3px solid #16a34a",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <p style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>
        Setting up your account...
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
