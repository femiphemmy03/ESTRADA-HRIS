import { createContext, useContext, useEffect, useState } from 'react';
import api from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadMe() {
    const token = localStorage.getItem('estrada_access_token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setEmployee(data.employee);
    } catch (err) {
      // Only treat this as "not logged in" if the token itself was rejected.
      // A transient 500 (e.g. a DB hiccup) should not log the person out.
      if (err.response?.status === 401) {
        localStorage.clear();
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('estrada_access_token', data.accessToken);
    localStorage.setItem('estrada_refresh_token', data.refreshToken);
    await loadMe();
    return data;
  }

  function logout() {
    localStorage.clear();
    setUser(null);
    setEmployee(null);
    window.location.href = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, employee, loading, login, logout, refresh: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
