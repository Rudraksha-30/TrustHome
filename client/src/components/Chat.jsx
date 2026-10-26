import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { timeAgo } from '../lib.js';
import { Notice } from './bits.jsx';

/**
 * Booking chat (FR-22). The page asks the server for anything that changed since the last check, every 5 seconds.
 * "Changed" includes edits and deletions, so when the other person edits or deletes a message you see it too.
 * (No websockets to host; plenty for a conversation about a booking.)
 */
export default function Chat({ bookingId, meId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text }
  const [confirming, setConfirming] = useState(null); // message id waiting for "Delete?" confirmation
  const logRef = useRef(null);
  const lastRef = useRef(null);

  // Add new messages and replace ones that were edited or deleted.
  const merge = (incoming) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m._id, m]));
      incoming.forEach((m) => byId.set(m._id, m));
      return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    });
    const newest = incoming.reduce((max, m) => {
      const t = m.updatedAt || m.createdAt;
      return new Date(t) > new Date(max) ? t : max;
    }, lastRef.current || incoming[0].updatedAt || incoming[0].createdAt);
    lastRef.current = newest;
  };

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    lastRef.current = null;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const qs = lastRef.current ? `?after=${encodeURIComponent(lastRef.current)}` : '';
        const d = await api.get(`/bookings/${bookingId}/messages${qs}`);
        if (!cancelled) merge(d.messages);
      } catch (e) {
        if (!cancelled && lastRef.current === null) setError(e.message);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bookingId]);

  const count = messages.length;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.post(`/bookings/${bookingId}/messages`, { text: body });
      merge([d.message]);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const body = editing.text.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.patch(`/bookings/${bookingId}/messages/${editing.id}`, { text: body });
      merge([d.message]);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setError('');
    try {
      const d = await api.del(`/bookings/${bookingId}/messages/${id}`);
      merge([d.message]);
      setConfirming(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="chat">
        <div className="chat-log" ref={logRef} aria-live="polite" aria-label="Messages">
          {messages.length === 0 && <p className="muted small">No messages yet. Say hello and confirm the details of the visit.</p>}
          {messages.map((m) => {
            const mine = m.sender?._id === meId;
            const isEditing = editing?.id === m._id;
            return (
              <div key={m._id} className={`bubble${mine ? ' mine' : ''}${m.deleted ? ' deleted' : ''}`} data-testid="message">
                {isEditing ? (
                  <form onSubmit={saveEdit} className="bubble-edit">
                    <input aria-label="Edit your message" value={editing.text} maxLength={1000} autoFocus onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                    <button className="btn btn-sm" type="submit" disabled={busy || !editing.text.trim()}>Save</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : m.deleted ? (
                  <em>This message was deleted</em>
                ) : (
                  m.text
                )}
                <small>
                  {mine ? 'You' : m.sender?.name} · {timeAgo(m.createdAt)}
                  {m.editedAt && !m.deleted && ' · edited'}
                </small>
                {mine && !m.deleted && !isEditing && (
                  <span className="bubble-actions">
                    {confirming === m._id ? (
                      <>
                        <button type="button" className="linkish danger" onClick={() => remove(m._id)}>Yes, delete</button>
                        <button type="button" className="linkish" onClick={() => setConfirming(null)}>Keep</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="linkish" onClick={() => setEditing({ id: m._id, text: m.text })}>Edit</button>
                        <button type="button" className="linkish danger" onClick={() => setConfirming(m._id)}>Delete</button>
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <form className="chat-form" onSubmit={send}>
          <input aria-label="Write a message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Write a message" />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
      <div style={{ marginTop: 10 }}><Notice>{error}</Notice></div>
    </div>
  );
}
