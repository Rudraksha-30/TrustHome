import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { categoryLabel, fmtMinutes } from '../lib.js';
import { Empty, Notice, VerifiedMark } from '../components/bits.jsx';

const LEVEL_WORD = { high: 'Needs attention', medium: 'Watch', low: 'Looks fine' };

/**
 * Point 2: the quality inspector's dashboard. Read-only. It lists every provider with the numbers that matter for
 * quality and flags the ones that cross a threshold. The inspector cannot warn, suspend or edit anyone.
 */
export default function Inspector() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    api.get(`/inspector/report?days=${days}`).then((d) => !cancelled && setData(d)).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [days]);

  const rows = useMemo(() => (data ? data.providers.filter((p) => filter === 'all' || p.level === filter) : []), [data, filter]);

  return (
    <main className="container page">
      <div className="row-between" style={{ marginBottom: 6 }}>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>Quality report</h1>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="muted">Read-only view of how each provider is performing. A flag means a number crossed a threshold; it is a reason to look closer, not a verdict.</p>
      <Notice>{error}</Notice>
      {!data && !error && <p className="muted">Building the report…</p>}

      {data && (
        <>
          <div className="stats" style={{ marginBottom: 18 }}>
            <div className="stat"><b>{data.totals.providers}</b><span className="muted small">Providers</span></div>
            <div className="stat"><b>{data.totals.high}</b><span className="muted small">Need attention</span></div>
            <div className="stat"><b>{data.totals.medium}</b><span className="muted small">Watch</span></div>
            <div className="stat"><b>{data.totals.low}</b><span className="muted small">Look fine</span></div>
          </div>

          <div className="row" style={{ marginBottom: 12 }} role="group" aria-label="Show">
            {['all', 'high', 'medium', 'low'].map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} className={`btn btn-sm ${filter === f ? '' : 'btn-ghost'}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : LEVEL_WORD[f]}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <Empty title="Nothing in this group">No providers match this filter.</Empty>
          ) : (
            <div className="panel table-wrap" style={{ padding: 0 }}>
              <table className="report">
                <thead>
                  <tr>
                    <th>Provider</th><th>Status</th><th>Trust</th><th>Jobs</th><th>Rating (recent)</th><th>Not available</th><th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.profileId} data-testid="report-row">
                      <td>
                        <strong>{p.name}</strong>{p.isVerified && <VerifiedMark />}
                        <div className="muted small">{p.categories.map(categoryLabel).join(', ')} · {p.serviceArea || 'no area'}</div>
                      </td>
                      <td>
                        <span className={`risk ${p.level}`}>{LEVEL_WORD[p.level]}</span>
                        <div className="muted small">{p.isListed ? 'Listed now' : 'Hidden from customers'}</div>
                      </td>
                      <td>{Math.round(p.trust.score)}{p.trust.isNewProvider && <div className="muted small">new</div>}</td>
                      <td>
                        {p.completedCount} done
                        <div className="muted small">{p.cancellationRate == null ? 'no accepted jobs' : `${p.cancellationRate}% cancelled by provider`}</div>
                      </td>
                      <td>
                        {p.averageRating ?? '–'} overall
                        <div className="muted small">{p.recentRating.average == null ? 'none recently' : `${p.recentRating.average} from ${p.recentRating.count}`}</div>
                      </td>
                      <td>
                        {p.availability.trackedMinutes === 0 ? '–' : `${p.availability.unavailablePct}%`}
                        <div className="muted small">{fmtMinutes(p.availability.unavailableMinutes)} of {fmtMinutes(p.availability.trackedMinutes)}</div>
                      </td>
                      <td>
                        {p.flags.length === 0 ? <span className="muted small">None</span> : (
                          <ul className="flag-list">{p.flags.map((f) => <li key={f.code} title={f.detail}><strong>{f.label}.</strong> {f.detail}</li>)}</ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>
            Thresholds: trust below {data.thresholds.LOW_TRUST_SCORE}, recent rating below {data.thresholds.LOW_RECENT_RATING}, more than {Math.round(data.thresholds.HIGH_CANCELLATION_RATE * 100)}% of accepted jobs cancelled by the provider, not available for more than {data.thresholds.OFTEN_UNAVAILABLE_PCT}% of tracked time.
          </p>
        </>
      )}
    </main>
  );
}
