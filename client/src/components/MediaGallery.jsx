import { useCallback, useEffect, useRef, useState } from 'react';
import { api, mediaSrc } from '../api.js';
import { prepareImage } from '../lib.js';
import { Notice } from './bits.jsx';

/**
 * Point 13: photos and videos on a booking.
 * The customer adds "problem" files (what needs fixing); the provider adds "work" files (what was done).
 * Everyone on the booking sees both groups; you can only remove the files you added.
 */
export default function MediaGallery({ bookingId, role, status, meId }) {
  const [items, setItems] = useState(null);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);
  const input = useRef(null);

  const load = useCallback(() => {
    api.get(`/bookings/${bookingId}/media`).then((d) => { setItems(d.media); setLimits(d.limits); }).catch((e) => setError(e.message));
  }, [bookingId]);
  useEffect(load, [load]);

  const canAdd = role === 'customer' ? ['requested', 'accepted', 'in_progress', 'completed'].includes(status) : ['accepted', 'in_progress', 'completed'].includes(status);

  const onPick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    for (const f of files) {
      try {
        const ready = await prepareImage(f);
        await api.upload(`/bookings/${bookingId}/media`, ready);
      } catch (err) {
        setError(`${f.name}: ${err.message}`);
        break;
      }
    }
    setBusy(false);
    load();
  };

  const remove = async (m) => {
    setError('');
    try {
      await api.del(`/media/${m._id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const group = (kind, title, empty) => {
    const list = (items || []).filter((m) => m.kind === kind);
    return (
      <div>
        <h3 style={{ fontSize: '1rem', margin: '14px 0 0' }}>{title}</h3>
        {list.length === 0 ? (
          <p className="muted small" style={{ margin: '6px 0 0' }}>{empty}</p>
        ) : (
          <div className="media-grid" data-testid={`media-${kind}`}>
            {list.map((m) => (
              <figure className="media-item" key={m._id} style={{ margin: 0 }}>
                {m.mediaType === 'video' ? (
                  <video src={mediaSrc(m.url)} controls preload="metadata" aria-label={m.filename} />
                ) : (
                  <img src={mediaSrc(m.url)} alt={m.filename} loading="lazy" onClick={() => setZoom(m)} />
                )}
                <figcaption>
                  <span className="muted">{m.uploader?.name}</span>
                  {m.uploader?._id === meId && <RemoveButton media={m} onRemove={remove} />}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Notice>{error}</Notice>
      {!items && !error && <p className="muted small">Loading files…</p>}
      {items && (
        <>
          {group('problem', 'Photos and videos of the problem', 'Nothing added by the customer yet.')}
          {group('work', 'Photos and videos of the finished work', 'Nothing added by the provider yet.')}
        </>
      )}
      {canAdd && limits && (
        <div style={{ marginTop: 14 }}>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            onChange={onPick}
            aria-label="Choose photos or videos"
            data-testid="media-input"
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => input.current.click()}>
            {busy ? 'Uploading…' : role === 'customer' ? 'Add photos or videos of the problem' : 'Add photos or videos of the work'}
          </button>
          <p className="field-hint">Photos up to {limits.imageMB} MB, videos up to {limits.videoMB} MB, {limits.maxFiles} files per booking.</p>
        </div>
      )}
      {zoom && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setZoom(null)}>
          <img src={mediaSrc(zoom.url)} alt={zoom.filename} />
        </div>
      )}
    </div>
  );
}

// The button is shown only on your own files. The server enforces the same rule (403 for anyone else).
function RemoveButton({ media, onRemove }) {
  return <button type="button" className="linkish" onClick={() => onRemove(media)} aria-label={`Remove ${media.filename}`}>Remove</button>;
}
