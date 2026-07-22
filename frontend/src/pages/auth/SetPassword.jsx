import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../lib/api.js';

export default function SetPassword() {
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
      await api.post('/auth/set-password', { token, password });
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Invalid onboarding link. Please use the link sent to your email.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/estrada-logo.png" alt="Estrada International" className="h-14 w-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Welcome to ESTRADA</h1>
          <p className="text-sm text-slate-400">Create your password to begin onboarding</p>
        </div>
        {success ? (
          <div className="card p-6 text-center text-green-600 dark:text-green-400">Password set! Redirecting to login…</div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm px-3 py-2 rounded-lg">{error}</div>}
            <div>
              <label className="label">New Password</label>
              <input type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input type="password" required className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Saving…' : 'Set Password & Continue'}
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
