import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDateTime, fmtMinutes } from '../lib.js';
import TrustDial from '../components/TrustDial.jsx';
import SignalBars from '../components/SignalBars.jsx';
import Portfolio from '../components/Portfolio.jsx';
import { Notice, VerifiedMark } from '../components/bits.jsx';

/** Points 8 and 9: the Available switch, and a record of how long it has been on and off. */
function AvailabilityPanel({ profile, onChanged }) {
  const [info, setInfo] = useState(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/providers/me/availability?days=${days}`).then(setInfo).catch((e) => setError(e.message));
  }, [days]);
  useEffect(load, [load]);

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.patch('/providers/me/availability', { available: !profile.isAvailable });
      onChanged(d.profile);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const on = profile.isAvailable === true;
  const s = info?.summary;
  return (
    <section className="panel avail" aria-labelledby="avail-h">
      <div className="row" style={{ justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 id="avail-h" style={{ margin: 0 }}>Availability</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {on ? 'Customers can find and book you right now.' : 'You are hidden from customers. Switch on when you are ready for work.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Available for bookings"
          className={`switch${on ? ' on' : ''}`}
          onClick={toggle}
          disabled={busy}
        >
          <span className="switch-knob" />
          <span className="switch-text">{on ? 'Available' : 'Not available'}</span>
        </button>
      </div>
      <Notice>{error}</Notice>

      {s && (
        <div className="avail-stats">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Time on each setting</h3>
            <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          {s.trackedMs === 0 ? (
            <p className="muted small">Tracking has just started. Numbers appear as time passes.</p>
          ) : (
            <>
              <div className="avail-bar" role="img" aria-label={`Available ${s.availablePct} percent, not available ${s.unavailablePct} percent`}>
                <span className="avail-on" style={{ width: `${s.availablePct}%` }} />
              </div>
              <dl className="avail-grid">
                <div><dt>Available</dt><dd data-testid="avail-on">{fmtMinutes(s.availableMinutes)} <small>({s.availablePct}%)</small></dd></div>
                <div><dt>Not available</dt><dd data-testid="avail-off">{fmtMinutes(s.unavailableMinutes)} <small>({s.unavailablePct}%)</small></dd></div>
                <div><dt>Times you switched</dt><dd>{s.switches}</dd></div>
              </dl>
              <p className="muted small" style={{ margin: 0 }}>
                Tracking since {fmtDateTime(s.trackingStartedAt)}. A quality inspector can see these figures, and being off for much of the time shows up as a flag.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function MyListing() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [services, setServices] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const fill = (p) => {
    setProfile(p);
    setForm({
      headline: p.headline || '',
      description: p.description || '',
      categories: p.categories || [],
      serviceArea: p.serviceArea || '',
      priceMin: p.priceMin ?? '',
      priceMax: p.priceMax ?? '',
      slotMinutes: p.slotMinutes ?? 60,
    });
  };

  useEffect(() => {
    api.get('/providers/meta/catalog').then((d) => setServices(d.services)).catch(() => {});
    api
      .get('/providers/me/profile')
      .then((d) => {
        if (d.profile) fill(d.profile);
        else {
          setProfile({ categories: [], trust: { score: 50, isNewProvider: true, reviewCount: 0 }, isAvailable: false });
          setForm({ headline: '', description: '', categories: [], serviceArea: '', priceMin: '', priceMax: '', slotMinutes: 60 });
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  if (!form) return <main className="container page">{error ? <Notice>{error}</Notice> : <p className="muted">Loading your listing…</p>}</main>;

  const set = (k) => (e) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };
  const toggleService = (key) => {
    setSaved(false);
    setForm({ ...form, categories: form.categories.includes(key) ? form.categories.filter((c) => c !== key) : [...form.categories, key] });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    if (form.categories.length === 0) return setError('Tick at least one service you offer.');
    if (form.priceMin !== '' && form.priceMax !== '' && Number(form.priceMin) > Number(form.priceMax)) {
      return setError('The lowest price cannot be higher than the highest price.');
    }
    setBusy(true);
    try {
      const d = await api.put('/providers/me/profile', {
        headline: form.headline.trim(),
        description: form.description.trim(),
        categories: form.categories,
        serviceArea: form.serviceArea.trim(),
        ...(form.priceMin !== '' ? { priceMin: Number(form.priceMin) } : {}),
        ...(form.priceMax !== '' ? { priceMax: Number(form.priceMax) } : {}),
        slotMinutes: Number(form.slotMinutes) || 60,
      });
      fill(d.profile);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const { trust } = profile;
  const incomplete = !profile.headline || profile.categories.length === 0 || !profile.serviceArea;

  return (
    <main className="container page">
      <h1 style={{ fontSize: '2rem' }}>My listing</h1>
      {incomplete && <Notice kind="info">Save a headline, at least one service and your service area first. Then you can switch yourself to Available.</Notice>}

      {profile._id && <AvailabilityPanel profile={profile} onChanged={(p) => setProfile({ ...profile, ...p })} />}

      {profile._id && (
        <section className="panel" style={{ marginTop: 20 }} aria-labelledby="pf-h">
          <h2 id="pf-h" style={{ marginTop: 0 }}>Photos of your previous work</h2>
          <Portfolio profileId={profile._id} manage />
        </section>
      )}

      <div className="detail" style={{ marginTop: 20 }}>
        <form className="panel" onSubmit={submit}>
          <Notice>{error}</Notice>
          {saved && <Notice kind="success">Listing saved.</Notice>}
          <div className="field">
            <label htmlFor="headline">Headline</label>
            <input id="headline" value={form.headline} onChange={set('headline')} maxLength={120} placeholder="Leaks, pipes and bathroom fittings fixed the same day" />
          </div>
          <div className="field">
            <label htmlFor="description">About your work</label>
            <textarea id="description" value={form.description} onChange={set('description')} maxLength={1000} />
          </div>
          <fieldset className="field services-set">
            <legend>Services you offer</legend>
            <div className="service-grid">
              {services.map((s) => (
                <label key={s.key} className="check">
                  <input type="checkbox" checked={form.categories.includes(s.key)} onChange={() => toggleService(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
            <p className="field-hint">Customers search by these same words, so pick the ones that fit.</p>
          </fieldset>
          <div className="field">
            <label htmlFor="area">City or area</label>
            <input id="area" value={form.serviceArea} onChange={set('serviceArea')} placeholder="Jaipur" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="pmin">Lowest price (₹)</label>
              <input id="pmin" type="number" min="0" value={form.priceMin} onChange={set('priceMin')} />
            </div>
            <div className="field">
              <label htmlFor="pmax">Highest price (₹)</label>
              <input id="pmax" type="number" min="0" value={form.priceMax} onChange={set('priceMax')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="slot">Time to set aside per booking</label>
            <select id="slot" value={form.slotMinutes} onChange={set('slotMinutes')}>
              {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}
            </select>
            <p className="field-hint">You set this once. Customers no longer choose a length when booking, because only you know how long a job takes. It only decides how much of your calendar a booking blocks.</p>
          </div>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save listing'}</button>
        </form>

        <aside className="panel sticky">
          <div className="row" style={{ gap: 16, marginBottom: 14 }}>
            <TrustDial score={trust.score} isNew={trust.isNewProvider} size={110} />
            <div>
              <h3 style={{ margin: 0 }}>Your Trust Score</h3>
              <p className="muted small" style={{ margin: 0 }}>{trust.reviewCount} {trust.reviewCount === 1 ? 'review' : 'reviews'}</p>
              <p className="small" style={{ margin: '6px 0 0' }}>
                {profile.isVerified ? <VerifiedMark /> : <span className="muted">Not verified yet. An admin checks new providers.</span>}
              </p>
            </div>
          </div>
          {trust.breakdown && <SignalBars breakdown={trust.breakdown} compact />}
          {profile._id && profile.isAvailable && !incomplete && <p style={{ marginTop: 16, marginBottom: 0 }}><Link to={`/providers/${profile._id}`}>View your public page</Link></p>}
        </aside>
      </div>
    </main>
  );
}
