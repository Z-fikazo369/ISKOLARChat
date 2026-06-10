import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GraduationCap, Shield, Settings, Send, BookOpen,
} from "lucide-react";
import { useTitle } from "../hooks/useTitle";
import ThemeToggle from "../components/ThemeToggle";

/* ── Animated chat demo (showcases what the bot can do) ───────── */
const SCRIPT = [
  { role: "user", text: "Hi! Ano ang admission requirements para sa freshmen? 😊" },
  { role: "bot", text: "Hello, future ka-ISU! Ihanda mo ang: Form 138, Certificate of Good Moral Character, PSA Birth Certificate, at 2×2 ID pictures.", sourced: true },
  { role: "user", text: "May entrance exam pa ba?" },
  { role: "bot", text: "Yes! May admission test mula sa Office of Student Affairs, interview, at medical exam. Kaya mo yan! 💪", sourced: true },
];

function ChatDemo() {
  const [step, setStep] = useState(0); // each step = 1 message; +typing between

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s >= SCRIPT.length * 2 + 2 ? 0 : s + 1));
    }, 1400);
    return () => clearInterval(timer);
  }, []);

  const shown = Math.min(Math.floor(step / 2), SCRIPT.length);
  const typing = step % 2 === 1 && shown < SCRIPT.length;

  const bubble = (msg, i) => (
    <div
      key={i}
      className="anim-fade-up"
      style={{
        display: "flex",
        justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
        marginBottom: "10px",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: "14px",
          fontSize: "13px",
          lineHeight: 1.55,
          ...(msg.role === "user"
            ? {
                background: "var(--primary)",
                color: "#fff",
                borderBottomRightRadius: "4px",
              }
            : {
                background: "var(--surface)",
                border: "1px solid var(--border-soft)",
                color: "var(--foreground)",
                borderBottomLeftRadius: "4px",
              }),
        }}
      >
        {msg.text}
        {msg.sourced && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              marginTop: "8px",
              fontSize: "10.5px",
              color: "var(--primary)",
              fontWeight: "700",
            }}
          >
            <BookOpen size={11} />
            ISU Student Manual — p. 9
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "400px",
        borderRadius: "18px",
        overflow: "hidden",
        border: "1px solid rgba(22,163,74,0.25)",
        boxShadow: "0 24px 60px rgba(22,163,74,0.15)",
        background: "var(--card)",
      }}
    >
      {/* header */}
      <div
        style={{
          background: "var(--primary)",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: "11px",
        }}
      >
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <GraduationCap size={17} color="#fff" />
        </div>
        <div>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "800" }}>ISKOLARChat</div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "11px" }}>
            I am here to assist you!
          </div>
        </div>
        <span
          style={{
            marginLeft: "auto",
            width: "9px",
            height: "9px",
            borderRadius: "50%",
            background: "#86efac",
            boxShadow: "0 0 8px #86efac",
          }}
        />
      </div>

      {/* messages */}
      <div style={{ height: "300px", padding: "16px", overflow: "hidden" }}>
        {SCRIPT.slice(0, shown).map(bubble)}
        {typing && (
          <div className="anim-fade-up" style={{ display: "flex", marginBottom: "10px" }}>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border-soft)",
                borderRadius: "14px",
                borderBottomLeftRadius: "4px",
                padding: "12px 16px",
                display: "flex",
                gap: "4px",
                alignItems: "center",
              }}
            >
              {[0, 0.2, 0.4].map((d) => (
                <span
                  key={d}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "var(--primary)",
                    display: "inline-block",
                    animation: `typingBounce 1.1s ${d}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* fake input */}
      <div
        style={{
          borderTop: "1px solid var(--border-soft)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "13px", color: "var(--muted-foreground)", flex: 1 }}>
          Ask me anything about ISU...
        </span>
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Send size={14} color="#fff" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  useTitle(null);

  const styles = {
    container: {
      background:
        "radial-gradient(900px 480px at 85% -5%, rgba(22,163,74,0.12), transparent 60%), linear-gradient(135deg, var(--background) 0%, var(--secondary) 100%)",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "9vh 20px 40px",
      color: "var(--foreground)",
      position: "relative",
      overflowX: "hidden",
    },
    header: { textAlign: "center", marginBottom: "56px" },
    title: {
      fontSize: "clamp(40px, 6vw, 54px)",
      fontWeight: "800",
      color: "var(--primary)",
      margin: "16px 0 14px",
      letterSpacing: "2px",
      textShadow: "0 0 30px rgba(22, 163, 74, 0.25)",
    },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      background: "rgba(22,163,74,0.1)",
      border: "1px solid rgba(22,163,74,0.3)",
      color: "var(--primary)",
      borderRadius: "999px",
      padding: "7px 16px",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "1px",
    },
    subtitle: { fontSize: "18px", color: "var(--muted-foreground)" },
    cardsContainer: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: "28px",
      maxWidth: "920px",
      width: "100%",
      marginBottom: "80px",
    },
    card: {
      background: "var(--card)",
      border: "1px solid rgba(22, 163, 74, 0.22)",
      borderRadius: "18px",
      padding: "34px",
      textAlign: "center",
      transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
    },
    cardHover: {
      boxShadow: "0 18px 48px rgba(22, 163, 74, 0.22)",
      borderColor: "rgba(22, 163, 74, 0.55)",
      transform: "translateY(-6px)",
    },
    iconCircle: {
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      background: "rgba(22, 163, 74, 0.12)",
      border: "1px solid rgba(22, 163, 74, 0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      margin: "0 auto 18px",
    },
    cardTitle: { fontSize: "23px", fontWeight: "800", color: "var(--primary)", marginBottom: "10px" },
    cardDesc: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      marginBottom: "22px",
      lineHeight: "1.65",
    },
    buttonGroup: { display: "flex", gap: "10px", flexDirection: "column" },
    button: {
      padding: "14px 24px",
      border: "none",
      borderRadius: "11px",
      fontSize: "15px",
      fontWeight: "700",
      cursor: "pointer",
      transition: "all 0.25s ease",
      letterSpacing: "0.3px",
      fontFamily: "inherit",
    },
    loginBtn: { background: "var(--primary)", color: "#fff" },
    signupBtn: {
      background: "transparent",
      border: "1.5px solid rgba(22,163,74,0.5)",
      color: "var(--primary)",
    },
    showcase: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "56px",
      flexWrap: "wrap",
      maxWidth: "1000px",
      width: "100%",
      marginBottom: "70px",
    },
    showcaseLeft: { flex: "1 1 380px", minWidth: "300px" },
    showcaseTitle: {
      fontSize: "clamp(26px, 3.4vw, 36px)",
      fontWeight: "800",
      lineHeight: 1.2,
      margin: "0 0 18px",
      letterSpacing: "-0.5px",
    },
    showcaseDesc: {
      fontSize: "15px",
      color: "var(--muted-foreground)",
      lineHeight: 1.8,
      marginBottom: "20px",
    },
    point: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      fontSize: "14px",
      color: "var(--text-secondary)",
      marginBottom: "10px",
    },
    footer: { textAlign: "center" },
    superAdminBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: "7px",
      background: "rgba(22, 163, 74, 0.08)",
      border: "1px solid rgba(22,163,74,0.35)",
      color: "var(--primary)",
      padding: "10px 20px",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "13.5px",
      fontFamily: "inherit",
      transition: "all 0.3s ease",
    },
  };

  const Portal = ({ icon: Icon, title, desc, onLogin, onSignup, signupLabel, delay }) => {
    const [isHovered, setIsHovered] = useState(false);
    return (
      <div
        className="anim-fade-up"
        style={{
          ...styles.card,
          ...(isHovered && styles.cardHover),
          animationDelay: delay,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div style={styles.iconCircle}>
          <Icon size={30} color="#16a34a" />
        </div>
        <h2 style={styles.cardTitle}>{title}</h2>
        <p style={styles.cardDesc}>{desc}</p>
        <div style={styles.buttonGroup}>
          <button
            style={{ ...styles.button, ...styles.loginBtn }}
            onClick={onLogin}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 8px 24px rgba(22, 163, 74, 0.45)")}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
          >
            Login
          </button>
          <button
            style={{ ...styles.button, ...styles.signupBtn }}
            onClick={onSignup}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(22,163,74,0.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {signupLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <ThemeToggle style={{ position: "absolute", top: "20px", right: "20px" }} />

      <div style={styles.header} className="anim-fade-up">
        <div style={styles.badge}>AI-POWERED ACADEMIC ASSISTANT</div>
        <h1 style={styles.title}>ISKOLARCHAT</h1>
        <p style={styles.subtitle}>Your Intelligent Academic Assistant</p>
      </div>

      {/* ── Showcase: what the bot can do ── */}
      <div style={styles.showcase}>
        <div style={styles.showcaseLeft} className="anim-fade-up">
          <h2 style={styles.showcaseTitle}>
            Answer common student queries with our{" "}
            <span style={{ color: "var(--primary)" }}>AI chatbot</span>
          </h2>
          <p style={styles.showcaseDesc}>
            ISKOLARChat understands questions in English, Filipino, or Taglish
            and answers them using the university's official knowledge base —
            complete with references. When the AI can't answer, a real admin
            steps in and the verified answer is added back to the knowledge base.
          </p>
          {[
            "Grounded on official ISU documents",
            "References shown with every answer",
            "Human-verified answers for hard questions",
          ].map((p) => (
            <div key={p} style={styles.point}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />
              {p}
            </div>
          ))}
        </div>
        <div className="anim-fade-up" style={{ animationDelay: "0.1s" }}>
          <ChatDemo />
        </div>
      </div>

      {/* ── Portals ── */}
      <p
        style={{
          fontSize: "13px",
          fontWeight: "700",
          letterSpacing: "2px",
          color: "var(--primary)",
          textTransform: "uppercase",
          marginBottom: "28px",
        }}
        className="anim-fade-up"
      >
        Choose your portal
      </p>
      <div style={styles.cardsContainer}>
        <Portal
          icon={GraduationCap}
          title="Student Portal"
          desc="Access AI-powered chat assistance for your academic needs"
          onLogin={() => navigate("/student/login")}
          onSignup={() => navigate("/student/signup")}
          signupLabel="Sign Up"
          delay="0.08s"
        />
        <Portal
          icon={Shield}
          title="Admin Portal"
          desc="Manage documents and oversee human-in-the-loop interventions"
          onLogin={() => navigate("/admin/login")}
          onSignup={() => navigate("/admin/apply")}
          signupLabel="Apply"
          delay="0.16s"
        />
      </div>

      <div style={styles.footer} className="anim-fade-in">
        <button
          style={styles.superAdminBtn}
          onClick={() => navigate("/superadmin/login")}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 0 18px rgba(22, 163, 74, 0.3)")}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
        >
          <Settings size={15} />
          Super Admin Portal
        </button>
      </div>
    </div>
  );
}
