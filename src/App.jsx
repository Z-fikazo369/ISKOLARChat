import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";

// Pages
import Home from "./pages/Home";
import StudentLogin from "./pages/auth/StudentLogin";
import StudentSignup from "./pages/auth/StudentSignup";
import AdminLogin from "./pages/auth/AdminLogin";
import AdminApply from "./pages/auth/AdminApply";
import SuperAdminLogin from "./pages/auth/SuperAdminLogin";
import AuthCallback from "./pages/auth/AuthCallback";
import StudentDashboard from "./pages/student/StudentDashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";
import SuperAdminDashboard from "./pages/superadmin/SuperAdminDashboard";

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, role, loading } = useAuth();

  if (loading)
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "var(--background)",
          color: "var(--muted-foreground)",
          gap: "12px",
        }}
      >
        <div
          style={{
            width: "24px",
            height: "24px",
            border: "2px solid rgba(22, 163, 74, 0.2)",
            borderTop: "2px solid #16a34a",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Loading...
      </div>
    );

  if (!user) return <Navigate to="/" replace />;
  if (allowedRoles && !allowedRoles.includes(role))
    return <Navigate to="/" replace />;

  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />

          {/* Auth callback — handles OAuth redirect & email confirmation */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Student Routes */}
          <Route path="/student/login" element={<StudentLogin />} />
          <Route path="/student/signup" element={<StudentSignup />} />
          <Route
            path="/student/dashboard"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/apply" element={<AdminApply />} />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Super Admin Routes */}
          <Route path="/superadmin/login" element={<SuperAdminLogin />} />
          <Route
            path="/superadmin/dashboard"
            element={
              <ProtectedRoute allowedRoles={["superadmin"]}>
                <SuperAdminDashboard />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
