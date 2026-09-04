import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tracks the currently resolved user id so we can tell a genuine sign-in
  // apart from Supabase re-emitting events for the SAME user.
  const userIdRef = useRef(null);

  useEffect(() => {
    // A rejected getSession() promise would leave `loading` true forever,
    // freezing the whole app behind the LoadingScreen — fail to "signed out"
    // instead so the user can actually use the app.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        const u = session?.user ?? null;
        userIdRef.current = u?.id ?? null;
        setUser(u);
        if (u) fetchRole(u.id);
        else setLoading(false);
      })
      .catch((err) => {
        console.error("getSession failed:", err?.message);
        userIdRef.current = null;
        setUser(null);
        setRole(null);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const newUser = session?.user ?? null;
      const newId = newUser?.id ?? null;

      // Supabase re-emits SIGNED_IN every time the tab regains focus, and fires
      // TOKEN_REFRESHED on silent refreshes. When it's the SAME user we already
      // resolved, do NOT raise the loading gate or refetch the role — that would
      // unmount ProtectedRoute's children and wipe in-progress chat state (the
      // "switching tabs starts a new chat" bug). Just keep the session fresh.
      if (newId && newId === userIdRef.current) {
        setUser(newUser);
        return;
      }

      userIdRef.current = newId;
      setUser(newUser);
      if (newUser) {
        // Genuinely new sign-in: the role isn't known yet, so raise the loading
        // gate and let ProtectedRoute wait for it instead of bouncing to home
        // (the original "first login redirects to home" bug).
        setLoading(true);
        // Run async Supabase queries in a timeout, NOT directly inside the
        // callback — calling them synchronously here can deadlock supabase-js's
        // internal auth lock and freeze token refresh (documented pitfall).
        setTimeout(() => fetchRole(newUser.id), 0);
      } else {
        setRole(null);
        setLoading(false);
      }
    });

    // Refresh the role when the tab regains focus: a demoted admin keeps a
    // stale admin UI otherwise (data is still RLS-protected, but the UI
    // shouldn't lie). Cheap single-row read; skipped when signed out.
    const refetchRoleOnFocus = () => {
      const id = userIdRef.current;
      if (id && document.visibilityState === "visible") fetchRole(id);
    };
    window.addEventListener("focus", refetchRoleOnFocus);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", refetchRoleOnFocus);
    };
  }, []);

  const fetchRole = async (userId) => {
    // Retry transient query failures (network blips) so an authenticated user
    // isn't bounced to "/" by a single failed profiles read.
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      if (!error) {
        // only an actual empty result (no profile row) means "no role"
        setRole(data ? data.role : null);
        setLoading(false);
        return;
      }
      lastError = error;
    }
    // Query kept erroring while a session exists — keep the previous role
    // instead of overwriting it with null.
    console.error("Failed to fetch role:", lastError?.message);
    setLoading(false);
  };

  const refreshRole = async (userId) => {
    const id = userId ?? user?.id;
    if (id) await fetchRole(id);
  };

  // scope: "local" — only end THIS tab's session; a global sign-out would
  // revoke the refresh tokens of the user's other per-tab sessions
  // (see the per-tab isolation setup in src/lib/supabaseClient.js).
  const logout = () => supabase.auth.signOut({ scope: "local" });

  return (
    <AuthContext.Provider value={{ user, role, loading, logout, refreshRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
