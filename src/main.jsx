import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// apply saved theme before first paint (avoids dark→light flash)
document.documentElement.dataset.theme = localStorage.getItem("theme") || "dark";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
