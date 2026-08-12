import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/estrada-logo.png" alt="Estrada International" className="h-14 w-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Reset your password</h1>
          <p className="text-sm text-slate-400 text-center mt-1">
            Enter your work email. If you never got around to setting a password, we'll send you a fresh onboarding invite instead.
          </p>
        </div>

        {submitted ? (
          <div className="card p-6 text-center space-y-3">
            <p className="text-green-600 dark:text-green-400 font-medium">Check your inbox</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              If an account exists for <strong>{email}</strong>, we've sent instructions to it. The link is valid for a limited time.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm px-3 py-2 rounded-lg">{error}</div>}
            <div>
              <label className="label">Email</label>
              <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@estradaintl.com" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending…' : 'Send reset instructions'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-400 mt-6">
          <Link to="/login" className="text-estrada-red hover:underline">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
