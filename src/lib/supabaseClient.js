import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Each browser tab gets its own isolated auth session.
// sessionStorage persists across reloads within the same tab but not across tabs.
// A unique storageKey also isolates the BroadcastChannel so tabs don't cross-signal.
const tabId = sessionStorage.getItem("_tab_id") || Math.random().toString(36).slice(2, 10);
sessionStorage.setItem("_tab_id", tabId);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.sessionStorage,
    storageKey: `sb_auth_${tabId}`,
    persistSession: true,
    autoRefreshToken: true,
  },
});
