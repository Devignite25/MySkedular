import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RoleProtectedRoute, AuthenticatedRoute } from './RouteProtection';
import { useAuth } from './AuthContext';

// Mock the useAuth hook
vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('Route Protection Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AuthenticatedRoute', () => {
    it('shows loading spinner when auth is loading', () => {
      vi.mocked(useAuth).mockReturnValue({
        session: null,
        user: null,
        profile: null,
        loading: true,
        recoveryMode: false,
        setRecoveryMode: () => {},
        updatePassword: async () => {},
        signOut: async () => {},
      });

      render(
        <MemoryRouter>
          <AuthenticatedRoute>
            <div>Protected Content</div>
          </AuthenticatedRoute>
        </MemoryRouter>
      );

      expect(screen.getByText('Verifying session...')).toBeInTheDocument();
    });

    it('redirects to login when unauthenticated', () => {
      vi.mocked(useAuth).mockReturnValue({
        session: null,
        user: null,
        profile: null,
        loading: false,
        recoveryMode: false,
        setRecoveryMode: () => {},
        updatePassword: async () => {},
        signOut: async () => {},
      });

      render(
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route
              path="/protected"
              element={
                <AuthenticatedRoute>
                  <div>Protected Content</div>
                </AuthenticatedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('renders children when authenticated', () => {
      vi.mocked(useAuth).mockReturnValue({
        session: { user: { id: 'user-1' } } as any,
        user: { id: 'user-1' } as any,
        profile: { id: 'user-1', role: 'employee', full_name: 'Test Employee' } as any,
        loading: false,
        recoveryMode: false,
        setRecoveryMode: () => {},
        updatePassword: async () => {},
        signOut: async () => {},
      });

      render(
        <MemoryRouter>
          <AuthenticatedRoute>
            <div>Protected Content</div>
          </AuthenticatedRoute>
        </MemoryRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('RoleProtectedRoute', () => {
    it('allows manager to access manager route', () => {
      vi.mocked(useAuth).mockReturnValue({
        session: { user: { id: 'manager-1' } } as any,
        user: { id: 'manager-1' } as any,
        profile: { id: 'manager-1', role: 'manager', full_name: 'Jorge' } as any,
        loading: false,
        recoveryMode: false,
        setRecoveryMode: () => {},
        updatePassword: async () => {},
        signOut: async () => {},
      });

      render(
        <MemoryRouter>
          <RoleProtectedRoute allowedRole="manager">
            <div>Manager Dashboard</div>
          </RoleProtectedRoute>
        </MemoryRouter>
      );

      expect(screen.getByText('Manager Dashboard')).toBeInTheDocument();
    });

    it('redirects employee to employee path when trying to access manager route', () => {
      vi.mocked(useAuth).mockReturnValue({
        session: { user: { id: 'employee-1' } } as any,
        user: { id: 'employee-1' } as any,
        profile: { id: 'employee-1', role: 'employee', full_name: 'Carla' } as any,
        loading: false,
        recoveryMode: false,
        setRecoveryMode: () => {},
        updatePassword: async () => {},
        signOut: async () => {},
      });

      render(
        <MemoryRouter initialEntries={['/manager-dashboard']}>
          <Routes>
            <Route path="/employee" element={<div>Employee Dashboard</div>} />
            <Route
              path="/manager-dashboard"
              element={
                <RoleProtectedRoute allowedRole="manager">
                  <div>Manager Dashboard</div>
                </RoleProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Employee Dashboard')).toBeInTheDocument();
      expect(screen.queryByText('Manager Dashboard')).not.toBeInTheDocument();
    });

    it('shows an error state instead of redirect-looping when profile fails to load', () => {
      vi.mocked(useAuth).mockReturnValue({
        session: { user: { id: 'employee-1' } } as any,
        user: { id: 'employee-1' } as any,
        profile: null,
        loading: false,
        recoveryMode: false,
        setRecoveryMode: () => {},
        updatePassword: async () => {},
        signOut: async () => {},
      });

      render(
        <MemoryRouter initialEntries={['/employee']}>
          <Routes>
            <Route
              path="/employee"
              element={
                <RoleProtectedRoute allowedRole="employee">
                  <div>Employee Dashboard</div>
                </RoleProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Unable to load your profile')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
      expect(screen.queryByText('Employee Dashboard')).not.toBeInTheDocument();
    });
  });
});
