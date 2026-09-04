import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GraduationCap, Send, BookOpen, ArrowLeft, ArrowRight,
  Paperclip, Brain, UserCheck, Mail, MapPin,
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
      // Skip the work while the tab is backgrounded — the animation is
      // invisible there and the timer only burns CPU/battery.
      if (document.hidden) return;
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

/* ── Rotating one-liners for the bottom strip pager ───────────── */
const FEATURES = [
  "Answers grounded on official ISU documents — with references",
  "Hybrid semantic + keyword search under the hood",
  "An AI agent that grades every source before it answers",
  "Real admins step in when the AI can't answer",
];

/* ── Feature highlight cards ──────────────────────────────────── */
const HIGHLIGHTS = [
  {
    icon: BookOpen,
    title: "Grounded Answers",
    desc: "Every reply is backed by official ISU documents, with page references shown below each answer.",
  },
  {
    icon: Paperclip,
    title: "Document Q&A",
    desc: "Upload a PDF, DOCX, or even a photo of a memo and ask questions about it directly.",
  },
  {
    icon: Brain,
    title: "Choose Your AI",
    desc: "Flash for speed, Pro for smarter answers, or R1 for deep step-by-step reasoning.",
  },
  {
    icon: UserCheck,
    title: "Human-Verified",
    desc: "Admin staff personally answer what the AI can't, and verified answers are added to the knowledge base.",
  },
];

export default function Home() {
  const navigate = useNavigate();
  useTitle(null);

  const [slide, setSlide] = useState(0);
  const featuresRef = useRef(null);

  const scrollToFeatures = () =>
    featuresRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const styles = {
    container: {
      background:
        "radial-gradient(900px 480px at 85% -5%, rgba(22,163,74,0.12), transparent 60%), linear-gradient(135deg, var(--background) 0%, var(--secondary) 100%)",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "7vh 20px 0",
      color: "var(--foreground)",
      position: "relative",
      overflowX: "hidden",
    },

    /* ── Floating hero card ── */
    heroCard: {
      width: "100%",
      maxWidth: "1100px",
      background: "var(--card)",
      border: "1px solid rgba(22,163,74,0.18)",
      borderRadius: "26px",
      boxShadow: "0 34px 90px rgba(0,0,0,0.22)",
      overflow: "hidden",
      marginBottom: "80px",
    },
    cardNav: {
      display: "flex",
      alignItems: "center",
      gap: "20px",
      padding: "20px 32px",
      borderBottom: "1px solid var(--border-soft)",
    },
    logo: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "15px",
      fontWeight: "800",
      letterSpacing: "0.5px",
      color: "var(--foreground)",
      whiteSpace: "nowrap",
    },
    navLinks: {
      flex: 1,
      display: "flex",
      justifyContent: "center",
      gap: "30px",
      flexWrap: "wrap",
    },
    navLink: {
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--muted-foreground)",
      padding: "4px 2px",
      transition: "color 0.2s",
    },
    heroBody: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "40px",
      flexWrap: "wrap",
      padding: "48px 56px 40px",
    },
    heroLeft: { flex: "1 1 360px", minWidth: "280px" },
    eyebrow: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      fontWeight: "800",
      letterSpacing: "1.8px",
      color: "var(--primary)",
      marginBottom: "18px",
    },
    eyebrowDot: {
      width: "8px",
      height: "8px",
      borderRadius: "2px",
      background: "var(--primary)",
      flexShrink: 0,
    },
    heroTitle: {
      fontSize: "clamp(32px, 4.6vw, 46px)",
      fontWeight: "800",
      lineHeight: 1.12,
      letterSpacing: "-1px",
      margin: "0 0 18px",
      color: "var(--foreground)",
    },
    heroDesc: {
      fontSize: "14px",
      color: "var(--muted-foreground)",
      lineHeight: 1.8,
      maxWidth: "360px",
      marginBottom: "26px",
    },
    ctaBtn: {
      background: "var(--primary)",
      color: "#fff",
      border: "none",
      borderRadius: "10px",
      padding: "14px 28px",
      fontSize: "14px",
      fontWeight: "700",
      cursor: "pointer",
      fontFamily: "inherit",
      letterSpacing: "0.3px",
      transition: "all 0.25s ease",
    },
    heroFooter: {
      display: "flex",
      alignItems: "center",
      gap: "18px",
      flexWrap: "wrap",
      padding: "16px 32px",
      borderTop: "1px solid var(--border-soft)",
    },
    exploreBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: "10px",
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "11px",
      fontWeight: "800",
      letterSpacing: "2px",
      color: "var(--foreground)",
      whiteSpace: "nowrap",
    },
    exploreIcon: {
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      border: "1.5px solid var(--foreground)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    featureLabel: {
      flex: "1 1 220px",
      textAlign: "center",
      fontSize: "13px",
      fontWeight: "600",
      color: "var(--muted-foreground)",
      minWidth: "180px",
    },
    pager: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginLeft: "auto",
    },
    pagerBtn: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "var(--muted-foreground)",
      padding: "4px",
      display: "flex",
      alignItems: "center",
      transition: "color 0.2s",
    },
    pageNum: {
      fontSize: "12px",
      fontWeight: "700",
      color: "var(--foreground)",
      whiteSpace: "nowrap",
      marginLeft: "4px",
    },

    /* ── Feature highlights ── */
    sectionLabel: {
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: "2px",
      color: "var(--primary)",
      textTransform: "uppercase",
      marginBottom: "28px",
      scrollMarginTop: "30px",
    },
    highlightsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
      gap: "22px",
      maxWidth: "1100px",
      width: "100%",
      marginBottom: "90px",
    },
    highlightCard: {
      background: "var(--card)",
      border: "1px solid rgba(22, 163, 74, 0.22)",
      borderRadius: "16px",
      padding: "28px 24px",
      textAlign: "center",
      transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
    },
    highlightCardHover: {
      boxShadow: "0 16px 40px rgba(22, 163, 74, 0.2)",
      borderColor: "rgba(22, 163, 74, 0.55)",
      transform: "translateY(-5px)",
    },
    highlightIcon: {
      width: "54px",
      height: "54px",
      borderRadius: "50%",
      background: "rgba(22, 163, 74, 0.12)",
      border: "1px solid rgba(22, 163, 74, 0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      margin: "0 auto 16px",
    },
    highlightTitle: {
      fontSize: "16px",
      fontWeight: "800",
      color: "var(--foreground)",
      marginBottom: "8px",
    },
    highlightDesc: {
      fontSize: "13px",
      color: "var(--muted-foreground)",
      lineHeight: 1.7,
    },

    /* ── Site footer ── */
    siteFooter: {
      width: "100%",
      maxWidth: "1100px",
      borderTop: "1px solid var(--border-soft)",
      padding: "44px 0 0",
    },
    footerCols: {
      display: "flex",
      flexWrap: "wrap",
      gap: "40px",
      marginBottom: "36px",
    },
    footerBrandCol: { flex: "1.5 1 240px", minWidth: "220px" },
    footerCol: { flex: "1 1 160px", minWidth: "150px" },
    footerHead: {
      fontSize: "13px",
      fontWeight: "800",
      color: "var(--foreground)",
      marginBottom: "14px",
    },
    footerLink: {
      display: "block",
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "13px",
      color: "var(--muted-foreground)",
      padding: "0",
      marginBottom: "11px",
      textAlign: "left",
      transition: "color 0.2s",
    },
    footerContactRow: {
      display: "flex",
      alignItems: "flex-start",
      gap: "9px",
      fontSize: "13px",
      color: "var(--muted-foreground)",
      marginBottom: "12px",
      lineHeight: 1.5,
    },
    footerBottom: {
      borderTop: "1px solid var(--border-soft)",
      padding: "18px 0 22px",
      textAlign: "center",
      fontSize: "12px",
      color: "var(--muted-2)",
    },
  };

  const NavLink = ({ label, onClick, active }) => (
    <button
      style={{
        ...styles.navLink,
        ...(active ? { color: "var(--primary)", fontWeight: "700" } : {}),
      }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
      onMouseLeave={(e) =>
        (e.currentTarget.style.color = active ? "var(--primary)" : "var(--muted-foreground)")
      }
    >
      {label}
    </button>
  );

  const FooterLink = ({ label, onClick }) => (
    <button
      style={styles.footerLink}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
    >
      {label}
    </button>
  );

  const Highlight = ({ icon: Icon, title, desc, delay }) => {
    const [isHovered, setIsHovered] = useState(false);
    return (
      <div
        className="anim-fade-up"
        style={{
          ...styles.highlightCard,
          ...(isHovered && styles.highlightCardHover),
          animationDelay: delay,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div style={styles.highlightIcon}>
          <Icon size={24} color="#16a34a" />
        </div>
        <h3 style={styles.highlightTitle}>{title}</h3>
        <p style={styles.highlightDesc}>{desc}</p>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* ── Floating hero card (nav + hero + feature strip) ── */}
      <div style={styles.heroCard} className="anim-fade-up">
        {/* nav */}
        <div style={styles.cardNav}>
          <div style={styles.logo}>
            <GraduationCap size={19} color="#16a34a" />
            ISKOLARChat<span style={{ color: "var(--primary)" }}>.</span>
          </div>
          <nav style={styles.navLinks}>
            <NavLink label="Home" active onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
            <NavLink label="Student Portal" onClick={() => navigate("/student/login")} />
            <NavLink label="Admin Portal" onClick={() => navigate("/admin/login")} />
          </nav>
          <ThemeToggle style={{ background: "none", border: "none" }} />
        </div>

        {/* hero body */}
        <div style={styles.heroBody}>
          <div style={styles.heroLeft}>
            <div style={styles.eyebrow}>
              <span style={styles.eyebrowDot} />
              ISU STUDENT SERVICES ASSISTANT
            </div>
            <h1 style={styles.heroTitle}>
              Your Campus Questions,{" "}
              <span style={{ color: "var(--primary)" }}>Answered.</span>
            </h1>
            <p style={styles.heroDesc}>
              The AI chatbot built for Isabela State University — ask about
              admission, enrollment, scholarships, and school policies, and get
              answers straight from official university records.
            </p>
            <button
              style={styles.ctaBtn}
              onClick={() => navigate("/student/signup")}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 10px 28px rgba(22,163,74,0.45)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
            >
              Get Started
            </button>
          </div>
          <div className="anim-fade-up" style={{ animationDelay: "0.1s" }}>
            <ChatDemo />
          </div>
        </div>

        {/* bottom strip — explore + feature pager */}
        <div style={styles.heroFooter}>
          <button
            style={styles.exploreBtn}
            onClick={scrollToFeatures}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--foreground)")}
          >
            <span style={styles.exploreIcon}>
              <GraduationCap size={13} />
            </span>
            EXPLORE NOW
          </button>
          <div style={styles.featureLabel} className="anim-fade-in" key={slide}>
            {FEATURES[slide]}
          </div>
          <div style={styles.pager}>
            <button
              style={styles.pagerBtn}
              onClick={() => setSlide((s) => (s + FEATURES.length - 1) % FEATURES.length)}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              style={styles.pagerBtn}
              onClick={() => setSlide((s) => (s + 1) % FEATURES.length)}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
            >
              <ArrowRight size={16} />
            </button>
            <span style={styles.pageNum}>
              0{slide + 1}{" "}
              <span style={{ color: "var(--muted-2)", fontWeight: "600" }}>. 04</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Feature highlights ── */}
      <p ref={featuresRef} style={styles.sectionLabel} className="anim-fade-up">
        Feature Highlights
      </p>
      <div style={styles.highlightsGrid}>
        {HIGHLIGHTS.map((h, i) => (
          <Highlight key={h.title} {...h} delay={`${0.06 + i * 0.07}s`} />
        ))}
      </div>

      {/* ── Site footer ── */}
      <footer style={styles.siteFooter}>
        <div style={styles.footerCols}>
          <div style={styles.footerBrandCol}>
            <div style={{ ...styles.logo, marginBottom: "14px" }}>
              <GraduationCap size={19} color="#16a34a" />
              ISKOLARChat<span style={{ color: "var(--primary)" }}>.</span>
            </div>
            <p
              style={{
                fontSize: "13px",
                color: "var(--muted-foreground)",
                lineHeight: 1.7,
                maxWidth: "280px",
                margin: 0,
              }}
            >
              The AI assistant for Isabela State University student services —
              grounded on official university documents, verified by real people.
            </p>
          </div>

          <div style={styles.footerCol}>
            <div style={styles.footerHead}>Portals</div>
            <FooterLink label="Student Login" onClick={() => navigate("/student/login")} />
            <FooterLink label="Student Sign Up" onClick={() => navigate("/student/signup")} />
            <FooterLink label="Admin Login" onClick={() => navigate("/admin/login")} />
            <FooterLink label="Apply as Admin" onClick={() => navigate("/admin/apply")} />
            <FooterLink label="Super Admin" onClick={() => navigate("/superadmin/login")} />
          </div>

          <div style={styles.footerCol}>
            <div style={styles.footerHead}>Explore</div>
            <FooterLink label="Home" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
            <FooterLink label="Feature Highlights" onClick={scrollToFeatures} />
          </div>

          <div style={styles.footerCol}>
            <div style={styles.footerHead}>Contact</div>
            <div style={styles.footerContactRow}>
              <Mail size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
              <a
                href="mailto:zyrilvillanueva23@gmail.com"
                style={{ color: "inherit", textDecoration: "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "inherit")}
              >
                zyrilvillanueva23@gmail.com
              </a>
            </div>
            <div style={styles.footerContactRow}>
              <MapPin size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
              <span>Isabela State University, Echague, Isabela</span>
            </div>
          </div>
        </div>

        <div style={styles.footerBottom}>
          © {new Date().getFullYear()} ISKOLARChat · Designed &amp; developed by
          Zyril Anne C. Villanueva
        </div>
      </footer>
    </div>
  );
}
