import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, TOKEN_STORAGE_KEY } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api
      .get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [logout]);

  // The login token lives in localStorage, which ALL tabs of this site share, but each tab keeps its own copy of
  // "who is signed in" in memory. If you sign in as someone else in tab B, tab A would still show the old name
  // while its requests (which read the shared token) quietly act as the new person. That mismatch made one
  // person's notifications appear under another person's name. The browser tells every OTHER tab when the token
  // changes, so each tab re-checks who it really is.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== null && e.key !== TOKEN_STORAGE_KEY) return;
      if (!getToken()) {
        setUser(null);
        return;
      }
      api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api.post('/auth/login', { email, password });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (form) => {
    const d = await api.post('/auth/register', form);
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setUser }),
    [user, loading, login, register, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
