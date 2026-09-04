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

// Generous cap — LLM answers are slow, but a fully hung backend must not
// leave the chat spinner (and its promise) pending forever.
const DEFAULT_TIMEOUT_MS = 120_000;

export async function apiFetch(path, options = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
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
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// multipart upload — same auth, but the browser sets the Content-Type
// (with boundary) itself, so we must not set it manually
export async function apiUpload(path, formData) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${res.status})`);
    }
    return res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The upload timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
