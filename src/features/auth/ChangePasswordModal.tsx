import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onClose }) => {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const close = () => {
    setPassword('');
    setConfirm('');
    setError(null);
    setSuccess(false);
    setLoading(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      setSuccess(true);
      setPassword('');
      setConfirm('');
    } catch (err: any) {
      setError(err.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="glass-panel w-full max-w-md p-7 rounded-2xl border border-slate-800 bg-[#0d1220]">
        <h3 className="text-lg font-bold text-white mb-1">Change Password</h3>
        <p className="text-xs text-slate-400 mb-5">Set a new password for your account (at least 6 characters).</p>

        {success ? (
          <div className="text-center space-y-5 py-4">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-950/40 border border-emerald-800/60 rounded-full text-emerald-400">
              <CheckCircle className="w-7 h-7" />
            </div>
            <p className="text-sm text-slate-300">Your password has been changed.</p>
            <button
              onClick={close}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-sm text-white transition cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="New password"
              className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
              disabled={loading}
            />
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 focus:border-indigo-500 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
              disabled={loading}
            />
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-semibold text-sm text-white transition cursor-pointer"
              >
                {loading ? 'Saving…' : 'Change Password'}
              </button>
              <button
                type="button"
                onClick={close}
                className="px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl font-semibold text-sm text-slate-300 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
