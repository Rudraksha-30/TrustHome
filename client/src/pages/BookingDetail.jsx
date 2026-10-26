import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { categoryLabel, fmtDate, fmtDateTime } from '../lib.js';
import Chat from '../components/Chat.jsx';
import MediaGallery from '../components/MediaGallery.jsx';
import Timeline from '../components/Timeline.jsx';
import { Notice, StatusBadge } from '../components/bits.jsx';

const DISPUTABLE = ['accepted', 'in_progress', 'completed', 'cancelled'];
const OUTCOME_LABEL = {
  provider_at_fault: 'Ruled in favour of the customer',
  customer_at_fault: 'Ruled in favour of the provider',
  no_fault: 'No fault found',
};

function ReviewForm({ bookingId, onDone, existing, onCancel }) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [comment, setComment] = useState(existing?.comment || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setError('Choose a rating from 1 to 5 stars.');
    setBusy(true);
    setError('');
    try {
      if (existing) await api.patch(`/reviews/${existing._id}`, { rating, comment: comment.trim() });
      else await api.post('/reviews', { bookingId, rating, comment: comment.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Notice>{error}</Notice>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
        <legend style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 6, padding: 0 }}>How did it go?</legend>
        <div className="row" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
              className={`btn btn-sm ${rating === n ? '' : 'btn-ghost'}`}
              onClick={() => setRating(n)}
            >
              {n} ★
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="r-comment">Comment (optional)</label>
        <textarea id="r-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Was the provider on time and tidy?" />
      </div>
      <div className="row">
        <button className="btn btn-accent" type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Post review'}</button>
        {existing && <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function DisputeForm({ bookingId, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Report a problem</button>;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/disputes', { bookingId, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Notice>{error}</Notice>
      <div className="field">
        <label htmlFor="d-reason">What went wrong?</label>
        <textarea id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={500} required placeholder="Describe the problem so an admin can review it." />
        <p className="field-hint">An admin reads this and decides. Ten characters minimum.</p>
      </div>
      <div className="row">
        <button className="btn btn-danger btn-sm" type="submit" disabled={busy || reason.trim().length < 10}>{busy ? 'Sending…' : 'Send to admin'}</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export default function BookingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [booking, setBooking] = useState(null);
  const [review, setReview] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [editingReview, setEditingReview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAdmin = user.role === 'admin';

  const load = useCallback(async () => {
    try {
      const b = (await api.get(`/bookings/${id}`)).booking;
      setBooking(b);
      const [d, r] = await Promise.all([
        api.get(`/bookings/${id}/disputes`).then((x) => x.disputes).catch(() => []),
        isAdmin ? null : api.get(`/bookings/${id}/review`).then((x) => x.review).catch(() => null),
      ]);
      setDisputes(d);
      setReview(r);
    } catch (e) {
      setError(e.message);
    }
  }, [id, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <main className="container page">
        <Notice>{error}</Notice>
        <Link to="/bookings">Back to bookings</Link>
      </main>
    );
  }
  if (!booking) return <main className="container page"><p className="muted">Loading booking…</p></main>;

  const isCustomer = booking.customer?._id === user._id;
  const isProvider = booking.provider?._id === user._id;
  const other = isProvider ? booking.customer : booking.provider;

  const change = async (status, why) => {
    setBusy(true);
    setActionError('');
    try {
      await api.patch(`/bookings/${id}/status`, { status, reason: why || undefined });
      setCancelling(false);
      setReason('');
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteReview = async () => {
    setActionError('');
    try {
      await api.del(`/reviews/${review._id}`);
      setConfirmDelete(false);
      setReview(null);
      await load();
    } catch (e) {
      setActionError(e.message);
    }
  };

  const s = booking.status;
  const canCancel = (isCustomer && (s === 'requested' || s === 'accepted')) || (isProvider && s === 'accepted');
  const canDispute = (isCustomer || isProvider) && DISPUTABLE.includes(s) && !booking.disputeOpen;

  return (
    <main className="container page">
      <p className="small"><Link to={isAdmin ? '/admin' : '/bookings'}>{isAdmin ? 'Admin' : 'All bookings'}</Link></p>
      <div className="row-between" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>{categoryLabel(booking.category)}</h1>
        <StatusBadge status={s} />
      </div>

      <div className="booking-grid">
        <section className="panel">
          <h2>Details</h2>
          <dl className="facts">
            <dt>{isAdmin ? 'Customer' : isProvider ? 'Customer' : 'Provider'}</dt>
            <dd>
              {isAdmin ? booking.customer?.name : other?.name}
              {!isProvider && !isAdmin && <> · <Link to="/providers">Browse other providers</Link></>}
            </dd>
            {isAdmin && (<><dt>Provider</dt><dd>{booking.provider?.name}</dd></>)}
            {isProvider && booking.customer?.phone && (<><dt>Phone</dt><dd>{booking.customer.phone}</dd></>)}
            <dt>When</dt><dd>{fmtDateTime(booking.scheduledStart)}</dd>
            <dt>Address</dt><dd>{booking.address || 'Not given'}</dd>
            <dt>Notes</dt><dd>{booking.notes || 'None'}</dd>
          </dl>
        </section>

        <section className="panel">
          <h2>Progress</h2>
          <Timeline booking={booking} />
        </section>

        {(isCustomer || isProvider) && (
          <section className="panel span-2">
            <h2>Next step</h2>
            <Notice>{actionError}</Notice>
            <div className="row">
              {isProvider && s === 'requested' && (
                <>
                  <button className="btn" disabled={busy} onClick={() => change('accepted')}>Accept booking</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => change('rejected')}>Decline</button>
                </>
              )}
              {isProvider && s === 'accepted' && <button className="btn" disabled={busy} onClick={() => change('in_progress')}>Start the job</button>}
              {isProvider && s === 'in_progress' && <button className="btn btn-accent" disabled={busy} onClick={() => change('completed')}>Mark as completed</button>}
              {canCancel && !cancelling && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => setCancelling(true)}>{s === 'requested' ? 'Cancel request' : 'Cancel booking'}</button>
              )}
              {isCustomer && s === 'requested' && <span className="muted small">Waiting for the provider to accept or decline.</span>}
              {isCustomer && s === 'accepted' && <span className="muted small">The provider will start the job at the scheduled time.</span>}
              {isCustomer && s === 'in_progress' && <span className="muted small">The job is under way. You can review it once it is completed.</span>}
              {['rejected', 'cancelled'].includes(s) && <span className="muted small">This booking is closed.</span>}
              {s === 'completed' && !isCustomer && <span className="muted small">Completed. The customer can now leave a review.</span>}
            </div>
            {cancelling && (
              <div style={{ marginTop: 14, maxWidth: 520 }}>
                <div className="field">
                  <label htmlFor="c-reason">Why are you cancelling? (optional)</label>
                  <textarea id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
                </div>
                <div className="row">
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => change('cancelled', reason.trim())}>Confirm cancellation</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(false)}>Keep booking</button>
                </div>
              </div>
            )}
          </section>
        )}

        {isCustomer && s === 'completed' && (
          <section className="panel span-2">
            <h2>Your review</h2>
            <Notice>{actionError}</Notice>
            {editingReview && review ? (
              <ReviewForm bookingId={id} existing={review} onCancel={() => setEditingReview(false)} onDone={async () => { setEditingReview(false); await load(); }} />
            ) : review ? (
              <>
                <div className="stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)}</div>
                <p style={{ margin: '4px 0 0' }}>{review.comment || 'No comment.'}</p>
                <p className="muted small" style={{ margin: '4px 0 10px' }}>Posted {fmtDate(review.createdAt)}{review.editedAt ? ` · edited ${fmtDate(review.editedAt)}` : ''}</p>
                {confirmDelete ? (
                  <div className="row">
                    <span className="small">Delete this review? Your rating will be removed from the provider's score.</span>
                    <button className="btn btn-danger btn-sm" onClick={deleteReview}>Yes, delete</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Keep it</button>
                  </div>
                ) : (
                  <div className="row">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingReview(true)}>Edit review</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>Delete review</button>
                  </div>
                )}
              </>
            ) : (
              <ReviewForm bookingId={id} onDone={load} />
            )}
          </section>
        )}

        {isProvider && s === 'completed' && review && (
          <section className="panel span-2">
            <h2>Customer review</h2>
            <div className="stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)}</div>
            <p style={{ margin: '4px 0 0' }}>{review.comment || 'No comment.'}</p>
          </section>
        )}

        {(disputes.length > 0 || canDispute) && (
          <section className="panel span-2">
            <h2>Problems reported</h2>
            {disputes.map((d) => (
              <div key={d._id} className="review">
                <div className="row-between">
                  <strong>{d.raisedBy?.name} reported a problem</strong>
                  <span className={`status ${d.status === 'open' ? 'status-requested' : 'status-completed'}`}>{d.status === 'open' ? 'Open' : 'Resolved'}</span>
                </div>
                <p style={{ margin: '4px 0' }}>{d.reason}</p>
                {d.status === 'resolved' && (
                  <p className="small" style={{ margin: 0 }}>
                    <strong>{OUTCOME_LABEL[d.outcome]}.</strong> {d.adminNote}
                  </p>
                )}
              </div>
            ))}
            {canDispute && <div style={{ marginTop: disputes.length ? 14 : 0 }}><DisputeForm bookingId={id} onDone={load} /></div>}
          </section>
        )}

        {(isCustomer || isProvider || isAdmin) && (
          <section className="panel span-2">
            <h2>Photos and videos</h2>
            <MediaGallery bookingId={id} role={isCustomer ? 'customer' : isProvider ? 'provider' : 'admin'} status={s} meId={user._id} />
          </section>
        )}

        {(isCustomer || isProvider) && (
          <section className="panel span-2">
            <h2>Chat with {other?.name}</h2>
            <Chat bookingId={id} meId={user._id} />
          </section>
        )}
      </div>
    </main>
  );
}
