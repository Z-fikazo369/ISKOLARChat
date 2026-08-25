import { supabase } from "./supabaseClient";

let API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  if (import.meta.env.DEV) {
    API_URL = "http://localhost:8000";
  } else {
    console.error(
      "VITE_API_URL is not set — falling back to relative API paths (same-origin reverse proxy). Set VITE_API_URL in the production environment."
    );
    API_URL = "";
  }
}

export async function apiFetch(path, options = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// multipart upload — same auth, but the browser sets the Content-Type
// (with boundary) itself, so we must not set it manually
export async function apiUpload(path, formData) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}
