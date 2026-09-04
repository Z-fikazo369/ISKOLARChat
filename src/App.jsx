import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Route-level chunks keep the landing/login download small. Heavy dashboards
// and the thesis comparison view load only when their route is opened.
const Home = lazy(() => import("./pages/Home"));
const StudentLogin = lazy(() => import("./pages/auth/StudentLogin"));
const StudentSignup = lazy(() => import("./pages/auth/StudentSignup"));
const AdminLogin = lazy(() => import("./pages/auth/AdminLogin"));
const AdminApply = lazy(() => import("./pages/auth/AdminApply"));
const SuperAdminLogin = lazy(() => import("./pages/auth/SuperAdminLogin"));
const AuthCallback = lazy(() => import("./pages/auth/AuthCallback"));
const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const SuperAdminDashboard = lazy(() => import("./pages/superadmin/SuperAdminDashboard"));
const CompareView = lazy(() => import("./pages/eval/CompareView"));
const compareViewEnabled = import.meta.env.VITE_COMPARE_VIEW_ENABLED === "true";

const LoadingScreen = () => (
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

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, role, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!user) return <Navigate to="/" replace />;
  if (allowedRoles && !allowedRoles.includes(role))
    return <Navigate to="/" replace />;

  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Router>
          <Suspense fallback={<LoadingScreen />}>
          <Routes>
          <Route path="/" element={<Home />} />

          {/* Auth callback — handles OAuth redirect & email confirmation */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {compareViewEnabled && (
            <Route
              path="/compare"
              element={
                // The comparison API requires an ADMIN account — enforced
                // server-side in app/routers/compare.py. The route gate only
                // mirrors that so students are bounced here instead of
                // hitting a 403 after the page loads.
                <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
                  <CompareView />
                </ProtectedRoute>
              }
            />
          )}

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
        </Suspense>
      </Router>
      </ErrorBoundary>
    </AuthProvider>
  );
}
