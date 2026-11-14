/**
 * Save as Draft, and the list of drafts waiting to be finished.
 *
 * Owner request (14 Nov 2026). A draft is only the form, put away: nothing
 * is numbered and nothing downstream exists until the form is submitted in
 * the ordinary way. Finishing a draft is therefore just filling in the rest
 * and pressing the form's own Create button — this component only gets the
 * form back on screen, and clears the draft once the record exists.
 *
 * Usage, from a form screen:
 *
 *   const drafts = useDrafts('quotation', form => ({ ... }), label);
 *   <DraftBar drafts={drafts} onResume={payload => setForm(payload)} />
 *   ... and after a successful create:  drafts.discard();
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export function useDrafts(kind, buildPayload, label) {
  const [list, setList] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const d = await api.get(`/api/form-drafts?kind=${kind}`);
      setList((d && d.drafts) || []);
    } catch (err) {
      setError(err.message);
    }
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  async function save() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const body = { kind, label: label || '', payload: buildPayload() };
      if (draftId) body.id = draftId;
      const d = await api.post('/api/form-drafts', body);
      if (d && d.draft) setDraftId(d.draft.id);
      setNote('Saved as draft.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Called once the real record exists, so the draft stops following you. */
  async function discard(id = draftId) {
    if (!id) return;
    try {
      await api.del(`/api/form-drafts/${id}`);
    } catch { /* the record is made; a leftover draft is not worth an alert */ }
    if (id === draftId) setDraftId(null);
    refresh();
  }

  async function open(id) {
    setError('');
    const d = await api.get(`/api/form-drafts/${id}`);
    setDraftId(id);
    return (d && d.draft && d.draft.payload) || null;
  }

  return { list, draftId, busy, note, error, save, discard, open, refresh };
}

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function DraftBar({ drafts, onResume, saveLabel = 'Save as Draft' }) {
  const [showList, setShowList] = useState(false);

  async function resume(id) {
    const payload = await drafts.open(id);
    if (payload) onResume(payload);
    setShowList(false);
  }

  return (
    <div className="draft-bar" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn sec" onClick={drafts.save} disabled={drafts.busy}>
          {drafts.busy ? 'Saving…' : saveLabel}
        </button>
        {drafts.list.length > 0 && (
          <button type="button" className="btn sec sm" onClick={() => setShowList((v) => !v)}>
            {showList ? 'Hide drafts' : `Drafts (${drafts.list.length})`}
          </button>
        )}
        {drafts.note && <span style={{ color: 'var(--ok, #1b7a3f)', fontSize: 13 }}>{drafts.note}</span>}
        {drafts.error && <span className="err" style={{ fontSize: 13 }}>{drafts.error}</span>}
      </div>

      {showList && (
        <ul className="draft-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {drafts.list.map((d) => (
            <li key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn sec sm" onClick={() => resume(d.id)}>
                {d.label || 'Untitled'}
              </button>
              <span style={{ fontSize: 12, color: '#667' }}>
                {when(d.updatedAt)}{d.userName ? ` · ${d.userName}` : ''}
              </span>
              <button type="button" className="btn sec sm" onClick={() => drafts.discard(d.id)} title="Throw this draft away">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
