import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface RouteProps {
  children: React.ReactNode;
}

export const AuthenticatedRoute: React.FC<RouteProps> = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const UnauthenticatedRoute: React.FC<RouteProps> = ({ children }) => {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session && profile) {
    if (profile.role === 'manager') {
      return <Navigate to="/manager" replace />;
    } else {
      return <Navigate to="/employee" replace />;
    }
  }

  return <>{children}</>;
};

interface RoleRouteProps extends RouteProps {
  allowedRole: 'manager' | 'employee';
}

export const RoleProtectedRoute: React.FC<RoleRouteProps> = ({ children, allowedRole }) => {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile || profile.role !== allowedRole) {
    // If wrong role, send them back to their appropriate home
    const fallbackRoute = profile?.role === 'manager' ? '/manager' : '/employee';
    return <Navigate to={fallbackRoute} replace />;
  }

  return <>{children}</>;
};
