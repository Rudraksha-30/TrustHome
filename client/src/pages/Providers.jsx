import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import ProviderCard from '../components/ProviderCard.jsx';
import { Empty, Notice } from '../components/bits.jsx';

// Point 11: customers cannot type a search. They pick a service and a city from lists, so a search always
// uses words that providers also chose from a list.
export default function Providers() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const area = params.get('area') || '';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [filters, setFilters] = useState({ services: [], areas: [] });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/providers/meta/filters').then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    const qs = new URLSearchParams({ page, limit: 8 });
    if (category) qs.set('category', category);
    if (area) qs.set('area', area);
    api
      .get(`/providers?${qs}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [category, area, page]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const hasFilters = category || area;

  return (
    <main className="container page">
      <h1 style={{ fontSize: '2rem' }}>Find a pro</h1>
      <p className="muted">Only professionals who are available right now are shown, highest Trust Score first.</p>

      <div className="filters" role="search">
        <div className="field">
          <label htmlFor="f-cat">Service</label>
          <select id="f-cat" value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All services</option>
            {filters.services.map((s) => (
              <option key={s.key} value={s.key}>{s.label} ({s.count})</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-area">City or area</label>
          <select id="f-area" value={area} onChange={(e) => update({ area: e.target.value })}>
            <option value="">Anywhere</option>
            {filters.areas.map((a) => (
              <option key={a.name} value={a.name}>{a.name} ({a.count})</option>
            ))}
          </select>
        </div>
        {hasFilters && <button className="btn btn-ghost" type="button" onClick={() => setParams({})}>Clear</button>}
      </div>

      <Notice>{error}</Notice>
      {!data && !error && <p className="muted">Loading providers…</p>}

      {data && data.providers.length === 0 && (
        <Empty title="No available providers match">
          Try a different service or city. Providers appear here only while they have switched themselves to Available.
        </Empty>
      )}

      {data && data.providers.length > 0 && (
        <>
          <p className="muted small">{data.total} {data.total === 1 ? 'provider' : 'providers'}</p>
          <div className="cards">
            {data.providers.map((p) => <ProviderCard key={p._id} provider={p} />)}
          </div>
          {data.pages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</button>
              <span className="muted small">Page {data.page} of {data.pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= data.pages} onClick={() => update({ page: String(page + 1) })}>Next</button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
