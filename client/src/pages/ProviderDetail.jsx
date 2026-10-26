import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { categoryLabel, fmtDate, localInputValue, priceRange } from '../lib.js';
import TrustDial from '../components/TrustDial.jsx';
import SignalBars from '../components/SignalBars.jsx';
import Portfolio from '../components/Portfolio.jsx';
import { Empty, Notice, VerifiedMark } from '../components/bits.jsx';

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function BookingForm({ profile }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const minStart = localInputValue(new Date(Date.now() + 60 * 60 * 1000));
  const [form, setForm] = useState({
    category: profile.categories[0] || '',
    when: '',
    address: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (!user) {
    return (
      <div className="panel sticky">
        <h3>Book {profile.user?.name}</h3>
        <p className="muted">Sign in as a customer to request a time.</p>
        <Link className="btn btn-accent btn-block" to={`/login?next=${encodeURIComponent(location.pathname)}`}>Sign in to book</Link>
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          New here? <Link to={`/register?next=${encodeURIComponent(location.pathname)}`}>Create an account</Link>
        </p>
      </div>
    );
  }
  if (user.role !== 'customer') {
    return (
      <div className="panel sticky">
        <h3>Booking</h3>
        <p className="muted" style={{ margin: 0 }}>Only customer accounts can book a provider.</p>
      </div>
    );
  }

  if (profile.isAvailable === false) {
    return (
      <div className="panel sticky">
        <h3>Not taking bookings</h3>
        <p className="muted" style={{ margin: 0 }}>{profile.user?.name} has switched to Not available. Try again later or pick another professional.</p>
        <p style={{ marginBottom: 0 }}><Link to="/providers">See available professionals</Link></p>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.when) return setError('Choose a date and time for the visit.');
    setBusy(true);
    try {
      const d = await api.post('/bookings', {
        providerId: profile.user._id,
        category: form.category,
        scheduledStart: new Date(form.when).toISOString(),
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      navigate(`/bookings/${d.booking._id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="panel sticky" onSubmit={submit}>
      <h3>Book {profile.user?.name}</h3>
      <Notice>{error}</Notice>
      <div className="field">
        <label htmlFor="b-cat">Service</label>
        <select id="b-cat" value={form.category} onChange={set('category')} required>
          {profile.categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="b-when">Date and time</label>
        <input id="b-when" type="datetime-local" min={minStart} value={form.when} onChange={set('when')} required />
      </div>
      <div className="field">
        <label htmlFor="b-addr">Address</label>
        <input id="b-addr" value={form.address} onChange={set('address')} maxLength={200} placeholder="Where should they come?" />
      </div>
      <div className="field">
        <label htmlFor="b-notes">Notes for the provider</label>
        <textarea id="b-notes" value={form.notes} onChange={set('notes')} maxLength={500} placeholder="What needs doing?" />
      </div>
      <button className="btn btn-accent btn-block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Request booking'}</button>
      <p className="field-hint">The provider will accept or decline and will plan the time the job needs. You can chat once they reply.</p>
    </form>
  );
}

export default function ProviderDetail() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError('');
    api.get(`/providers/${id}`).then((d) => !cancelled && setProfile(d.profile)).catch((e) => !cancelled && setError(e.message));
    api.get(`/providers/${id}/reviews`).then((d) => !cancelled && setReviews(d.reviews)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main className="container page">
        <Notice>{error}</Notice>
        <Link to="/providers">Back to all providers</Link>
      </main>
    );
  }
  if (!profile) return <main className="container page"><p className="muted">Loading provider…</p></main>;

  const { trust } = profile;
  return (
    <main className="container page">
      <p className="small"><Link to="/providers">All providers</Link></p>
      <div className="detail">
        <div className="stack">
          <div className="panel">
            <div className="detail-head">
              <TrustDial score={trust.score} isNew={trust.isNewProvider} size={150} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <h1 style={{ fontSize: '2rem', marginBottom: 4 }}>
                  {profile.user?.name}
                  {profile.isVerified && <VerifiedMark />}
                </h1>
                <p style={{ margin: '0 0 6px' }}>{profile.headline}</p>
                <div className="chips">
                  {profile.categories.map((c) => <span key={c} className="chip">{categoryLabel(c)}</span>)}
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  {profile.serviceArea || 'Area not set'} · {priceRange(profile.priceMin, profile.priceMax)} · {trust.reviewCount} {trust.reviewCount === 1 ? 'review' : 'reviews'}
                </p>
              </div>
            </div>
            {profile.description && <p style={{ marginTop: 18, marginBottom: 0 }}>{profile.description}</p>}
          </div>

          <Portfolio profileId={profile._id} />

          <div className="panel">
            <h2>Why this score</h2>
            {trust.isNewProvider && trust.reviewCount < 3 && (
              <Notice kind="info">New provider: fewer than 3 reviews so far, so the score is still settling.</Notice>
            )}
            <SignalBars breakdown={trust.breakdown} />
          </div>

          <div className="panel">
            <h2>Reviews</h2>
            {reviews.length === 0 ? (
              <Empty title="No reviews yet">Reviews appear here after a customer finishes a booking with this provider.</Empty>
            ) : (
              reviews.map((r) => (
                <div className="review" key={r._id}>
                  <div className="row-between">
                    <strong>{r.customer?.name}</strong>
                    <span className="muted small">{fmtDate(r.createdAt)}</span>
                  </div>
                  <div className="stars" aria-label={`${r.rating} out of 5 stars`}>{stars(r.rating)}</div>
                  {r.comment && <p style={{ margin: '4px 0 0' }}>{r.comment}</p>}
                </div>
              ))
            )}
          </div>
        </div>
        <BookingForm profile={profile} />
      </div>
    </main>
  );
}
