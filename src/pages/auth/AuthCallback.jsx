import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { useTitle } from "../../hooks/useTitle";

export default function AuthCallback() {
  useTitle("Setting up...");
  const navigate = useNavigate();
  const { user, loading, refreshRole } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/");
      return;
    }

    const handleCallback = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile) {
        // Fallback if the DB trigger didn't run; role is always 'student' —
        // user_metadata is client-controlled and must not decide roles.
        await supabase.from("profiles").insert({
          id: user.id,
          email: user.email,
          role: "student",
        });
        await refreshRole(user.id);
        navigate("/student/dashboard");
      } else if (profile.role === "student") {
        navigate("/student/dashboard");
      } else if (profile.role === "admin" || profile.role === "superadmin") {
        navigate("/admin/dashboard");
      } else {
        navigate("/");
      }
    };

    handleCallback();
  }, [user, loading]);

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
