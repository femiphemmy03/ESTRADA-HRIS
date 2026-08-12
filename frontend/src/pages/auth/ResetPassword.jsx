import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../lib/api.js';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div>
          <p className="text-slate-500 mb-3">Invalid reset link.</p>
          <Link to="/forgot-password" className="text-estrada-red hover:underline text-sm">Request a new one</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/estrada-logo.png" alt="Estrada International" className="h-14 w-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Choose a new password</h1>
        </div>
        {success ? (
          <div className="card p-6 text-center text-green-600 dark:text-green-400">Password reset! Redirecting to login…</div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm px-3 py-2 rounded-lg">
                {error}
                {error.toLowerCase().includes('expired') || error.toLowerCase().includes('not valid') ? (
                  <>
                    {' '}<Link to="/forgot-password" className="underline">Request a new link</Link>
                  </>
                ) : null}
              </div>
            )}
            <div>
              <label className="label">New Password</label>
              <input type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input type="password" required className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Saving…' : 'Reset Password'}
            </button>
          </form>
        )}
        <p className="text-center text-sm text-slate-400 mt-4">
          <Link to="/login" className="text-estrada-red hover:underline">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
