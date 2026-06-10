import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export default function ThemeToggle({ style }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "rgba(22, 163, 74, 0.08)",
        border: "1px solid rgba(22, 163, 74, 0.3)",
        borderRadius: "8px",
        color: "var(--primary)",
        cursor: "pointer",
        padding: "8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "inherit",
        ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(22,163,74,0.18)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(22,163,74,0.08)")}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
