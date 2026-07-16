import React from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { Login } from './features/auth/Login';
import { ForgotPassword } from './features/auth/ForgotPassword';
import { ResetPassword } from './features/auth/ResetPassword';
import {
  UnauthenticatedRoute,
  RoleProtectedRoute,
  homeRouteForRole
} from './features/auth/RouteProtection';
import { AdminDashboard } from './features/admin/AdminDashboard';
import { ManagerDashboard } from './features/manager/ManagerDashboard';
import { EmployeeDashboard } from './features/employee/EmployeeDashboard';

const RootRedirect: React.FC = () => {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={homeRouteForRole(profile?.role)} replace />;
};

const AppContent: React.FC = () => {
  const { recoveryMode } = useAuth();
  const navigate = useNavigate();

  // If in recovery mode, force password reset page
  if (recoveryMode) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center px-4">
        <ResetPassword />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      
      {/* Auth Routes */}
      <Route
        path="/login"
        element={
          <UnauthenticatedRoute>
            <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center px-4">
              <Login onForgotPasswordClick={() => navigate('/forgot-password')} />
            </div>
          </UnauthenticatedRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <UnauthenticatedRoute>
            <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center px-4">
              <ForgotPassword onBackToLogin={() => navigate('/login')} />
            </div>
          </UnauthenticatedRoute>
        }
      />

      {/* Protected Dashboard Routes */}
      <Route
        path="/admin"
        element={
          <RoleProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/manager"
        element={
          <RoleProtectedRoute allowedRoles={['manager', 'admin']}>
            <ManagerDashboard />
          </RoleProtectedRoute>
        }
      />
      <Route
        path="/employee"
        element={
          <RoleProtectedRoute allowedRoles={['employee']}>
            <EmployeeDashboard />
          </RoleProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
