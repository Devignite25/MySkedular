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
  const { session, profile, loading, signOut } = useAuth();

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

  if (!profile) {
    // Session exists but the profile failed to load (network error, RLS denial).
    // Redirecting here would loop back to this same route forever, so show a
    // recoverable error state instead.
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center px-4">
        <div className="w-full max-w-md p-8 glass-panel rounded-2xl border border-slate-800 text-center space-y-4">
          <h2 className="text-lg font-bold text-white">Unable to load your profile</h2>
          <p className="text-sm text-slate-400">
            You are signed in, but your profile could not be loaded. Check your
            connection and try again, or sign out and back in.
          </p>
          <button
            onClick={() => signOut()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-sm text-white transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (profile.role !== allowedRole) {
    // If wrong role, send them back to their appropriate home
    const fallbackRoute = profile.role === 'manager' ? '/manager' : '/employee';
    return <Navigate to={fallbackRoute} replace />;
  }

  return <>{children}</>;
};
