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
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      userIdRef.current = u?.id ?? null;
      setUser(u);
      if (u) fetchRole(u.id);
      else setLoading(false);
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
        fetchRole(newUser.id);
      } else {
        setRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchRole = async (userId) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (!error && data) {
      setRole(data.role);
    } else {
      setRole(null);
    }
    setLoading(false);
  };

  const refreshRole = async (userId) => {
    const id = userId ?? user?.id;
    if (id) await fetchRole(id);
  };

  const logout = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ user, role, loading, logout, refreshRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
