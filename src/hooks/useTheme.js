import { useEffect, useState } from "react";

// Same-tab sync channel: the `storage` event only fires across tabs, so two
// ThemeToggles on one page would otherwise show contradictory icons.
const THEME_EVENT = "iskolar-theme-change";

export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark"
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  }, [theme]);

  useEffect(() => {
    const sync = (e) => setTheme(e.detail || localStorage.getItem("theme") || "dark");
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}
