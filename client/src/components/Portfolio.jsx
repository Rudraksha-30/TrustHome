import { useCallback, useEffect, useRef, useState } from 'react';
import { api, mediaSrc } from '../api.js';
import { prepareImage } from '../lib.js';
import { Notice } from './bits.jsx';

/**
 * A provider's "previous work" photos.
 *   manage = true   on My listing: add, caption and remove photos
 *   manage = false  on the public provider page: a read-only gallery (only returns anything for signed-in users)
 * These are separate from the private photos attached to a booking.
 */
export default function Portfolio({ profileId, manage = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [caption, setCaption] = useState('');
  const input = useRef(null);

  const load = useCallback(() => {
    api.get(`/providers/${profileId}/portfolio`).then(setData).catch((e) => setError(e.message));
  }, [profileId]);
  useEffect(load, [load]);

  const onPick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    for (const f of files) {
      try {
        const ready = await prepareImage(f);
        await api.upload('/providers/me/portfolio', ready, files.length === 1 ? caption.trim() : '');
      } catch (err) {
        setError(`${f.name}: ${err.message}`);
        break;
      }
    }
    setCaption('');
    setBusy(false);
    load();
  };

  const remove = async (p) => {
    setError('');
    try {
      await api.del(`/providers/me/portfolio/${p._id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const photos = data?.photos || [];
  // Viewers with nothing to look at do not need an empty section.
  if (!manage && data && photos.length === 0) return null;

  const Wrap = manage ? 'div' : PublicPanel;
  return (
    <Wrap>
      <Notice>{error}</Notice>
      {!data && !error && <p className="muted small">Loading photos…</p>}
      {data && photos.length === 0 && manage && (
        <p className="muted small">No photos yet. Add pictures of jobs you are proud of so customers can see your work.</p>
      )}
      {photos.length > 0 && (
        <div className="media-grid" data-testid="portfolio-grid">
          {photos.map((p) => (
            <figure className="media-item" key={p._id} style={{ margin: 0 }}>
              <img src={mediaSrc(p.url)} alt={p.caption || 'Previous work'} loading="lazy" onClick={() => setZoom(p)} />
              {(p.caption || manage) && (
                <figcaption>
                  <span className="muted">{p.caption}</span>
                  {manage && <button type="button" className="linkish" onClick={() => remove(p)} aria-label={`Remove ${p.caption || 'photo'}`}>Remove</button>}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
      {manage && data && (
        <div style={{ marginTop: 10 }}>
          <input ref={input} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPick} aria-label="Choose portfolio photos" data-testid="portfolio-input" />
          <label htmlFor="pf-caption">Caption for the next photo (optional)</label>
          <input id="pf-caption" value={caption} maxLength={120} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Kitchen tap replaced" />
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} disabled={busy || photos.length >= data.max} onClick={() => input.current.click()}>
            {busy ? 'Uploading…' : 'Add photos'}
          </button>
          <p className="field-hint">{photos.length} of {data.max} photos. Up to {data.maxMB} MB each. Customers who are signed in can see these on your page.</p>
        </div>
      )}
      {zoom && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setZoom(null)}>
          <img src={mediaSrc(zoom.url)} alt={zoom.caption || 'Previous work'} />
        </div>
      )}
    </Wrap>
  );
}

function PublicPanel({ children }) {
  return (
    <div className="panel">
      <h2>Previous work</h2>
      {children}
    </div>
  );
}
