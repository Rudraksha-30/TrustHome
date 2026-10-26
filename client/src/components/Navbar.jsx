import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Trusted Local Pros, home">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#0E2F55" />
        <path d="M7 21a9 9 0 1 1 18 0" fill="none" stroke="#FFC400" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M16 21l5-7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="16" cy="21" r="2" fill="#fff" />
      </svg>
      <span>Trusted Local Pros</span>
    </Link>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  // The bell checks for new notifications every 20 seconds while signed in (FR-12).
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return undefined;
    }
    let cancelled = false;
    const load = () =>
      api
        .get('/notifications/unread-count')
        .then((d) => !cancelled && setUnread(d.unread))
        .catch(() => {});
    load();
    const id = setInterval(load, 20000);
    const onChange = () => load();
    window.addEventListener('notifications-changed', onChange);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('notifications-changed', onChange);
    };
  }, [user]);

  const signOut = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Brand />
        <nav className="nav-links" aria-label="Main">
          {(!user || user.role === 'customer') && <NavLink to="/providers">Find a pro</NavLink>}
          {user?.role === 'customer' && <NavLink to="/bookings">My bookings</NavLink>}
          {user?.role === 'provider' && <NavLink to="/bookings">Bookings</NavLink>}
          {user?.role === 'provider' && <NavLink to="/listing">My listing</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          {user?.role === 'inspector' && <NavLink to="/inspector">Quality report</NavLink>}
        </nav>
        <div className="nav-user">
          {user ? (
            <>
              <Link to="/notifications" className="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M12 3a6 6 0 0 0-6 6v3.5L4.5 16h15L18 12.5V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
              </Link>
              <span className="nav-name">{user.name}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link to="/register" className="btn btn-accent btn-sm">Create account</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
