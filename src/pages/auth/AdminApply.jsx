import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Shield, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useTitle } from "../../hooks/useTitle";

export default function AdminApply() {
  const navigate = useNavigate();
  useTitle("Admin Application");
  const [formData, setFormData] = useState({
    fullName: "",
    employeeId: "",
    department: "",
    position: "",
    email: "",
    phone: "",
    reason: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            admin_application: {
              full_name: formData.fullName,
              employee_id: formData.employeeId,
              department: formData.department,
              position: formData.position,
              email: formData.email,
              phone: formData.phone,
              reason: formData.reason,
            },
          },
        },
      });

      if (signupError) throw signupError;

      // Supabase obfuscates existing emails by returning a fake user with an
      // empty identities array — surface that instead of pretending it worked.
      if (data?.user && (data.user.identities?.length ?? 0) === 0) {
        throw new Error(
          "This email is already registered. Please log in instead."
        );
      }

      // The admin_applications row is created by the
      // on_admin_application_user_created DB
      // trigger from the metadata above (client-side inserts fail when email
      // confirmation is enabled, because there is no session yet).

      // Sign out immediately — account needs super admin approval before login
      await supabase.auth.signOut({ scope: "local" });

      alert(
        "Application submitted! Please wait for super admin approval before logging in."
      );
      navigate("/");
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
      padding: "20px",
      color: "var(--foreground)",
    },
    backBtn: {
      background: "none",
      border: "none",
      color: "var(--primary)",
      cursor: "pointer",
      fontSize: "14px",
      marginBottom: "20px",
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
      maxWidth: "620px",
      margin: "0 auto",
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
    warning: {
      background: "rgba(234, 179, 8, 0.08)",
      border: "1px solid rgba(234, 179, 8, 0.25)",
      color: "#fbbf24",
      padding: "12px 14px",
      borderRadius: "8px",
      fontSize: "13px",
      marginBottom: "24px",
      lineHeight: "1.5",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "16px",
    },
    formGroup: {
      marginBottom: "0",
    },
    fullWidth: {
      gridColumn: "1 / -1",
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
    },
    textarea: {
      width: "100%",
      padding: "12px",
      background: "rgba(22, 163, 74, 0.05)",
      border: "1px solid rgba(22, 163, 74, 0.25)",
      borderRadius: "8px",
      color: "var(--foreground)",
      fontSize: "14px",
      fontFamily: "inherit",
      boxSizing: "border-box",
      minHeight: "100px",
      resize: "vertical",
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
      marginTop: "24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      transition: "opacity 0.2s",
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

  const field = (name, label, type = "text", placeholder = "") => (
    <div style={s.formGroup}>
      <label style={s.label}>{label} *</label>
      <input
        type={type}
        name={name}
        style={s.input}
        value={formData[name]}
        onChange={handleChange}
        placeholder={placeholder}
        required
        disabled={loading}
      />
    </div>
  );

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
          <p style={s.subtitle}>
            Admin Application Form — Subject to Super Admin Approval
          </p>
        </div>

        {error && (
          <div style={s.error}>
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <div style={s.warning}>
          <strong>Note:</strong> Your application will be reviewed by the super
          admin. You will only be able to login after your account has been
          approved.
        </div>

        <form onSubmit={handleSubmit}>
          <div style={s.grid}>
            {field("fullName", "Full Name", "text", "Prof. Maria Santos")}
            {field("employeeId", "Employee ID", "text", "EMP-2024-001")}
            {field("department", "Department", "text", "Computer Science")}
            {field("position", "Position / Title", "text", "Assistant Professor")}
            {field("email", "Official Email", "email", "m.santos@university.edu")}
            {field("phone", "Phone Number", "tel", "+63 912 345 6789")}

            <div style={{ ...s.formGroup, ...s.fullWidth }}>
              <label style={s.label}>Reason for Admin Access *</label>
              <textarea
                name="reason"
                style={s.textarea}
                value={formData.reason}
                onChange={handleChange}
                placeholder="Please explain why you need admin access and how you plan to use it..."
                required
                disabled={loading}
              />
            </div>

            {field("password", "Create Password", "password", "Min. 8 characters")}
            {field("confirmPassword", "Confirm Password", "password", "Re-enter password")}
          </div>

          <button
            type="submit"
            style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? "Submitting..." : "Submit Application"}
          </button>

          <div style={s.footer}>
            Already approved?{" "}
            <Link to="/admin/login" style={s.link}>
              Login here
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
