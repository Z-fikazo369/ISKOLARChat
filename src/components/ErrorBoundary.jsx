import { Component } from "react";

// Catches render-time errors anywhere below it. Without this, one bad
// component (e.g. a render that dereferences an unexpected API response)
// unmounts the ENTIRE React tree — a blank white page with no recovery.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("UI error caught by boundary:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "var(--background)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            padding: "20px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "22px", color: "var(--foreground)" }}>
            Something went wrong
          </h1>
          <p
            style={{
              color: "var(--muted-foreground)",
              fontSize: "14px",
              maxWidth: "420px",
              lineHeight: 1.5,
            }}
          >
            An unexpected error occurred. Your data is safe — reloading the page
            usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 22px",
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "700",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
