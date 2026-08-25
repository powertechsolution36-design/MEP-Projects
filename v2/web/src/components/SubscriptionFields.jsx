import { useMemo } from 'react';

// Reusable subscription-config block. Reads/writes onto `meta.subscription`.
// Props: sub (object), onChange(nextSub)
const PLANS = [
  { value: 'trial',    label: 'Free Trial',   months: 0.5 },
  { value: '1month',   label: '1 Month',      months: 1 },
  { value: '3month',   label: '3 Months',     months: 3 },
  { value: '6month',   label: '6 Months',     months: 6 },
  { value: '1year',    label: '1 Year',       months: 12 },
  { value: 'custom',   label: 'Custom',       months: null },
];

export function computeRenewsOn(startISO, months) {
  if (!startISO || !months) return '';
  const d = new Date(startISO);
  d.setMonth(d.getMonth() + Number(months));
  // For fractional months (trial 0.5), add days instead
  if (String(months).includes('.')) {
    const extraDays = Math.round((Number(months) - Math.floor(months)) * 30);
    d.setDate(d.getDate() + extraDays);
  }
  return d.toISOString().slice(0, 10);
}

export default function SubscriptionFields({ sub = {}, onChange }) {
  const plan = sub.plan || '1month';
  const months = plan === 'custom' ? (sub.customMonths || 1) : PLANS.find(p => p.value === plan)?.months;
  const startedAt = sub.startedAt ? new Date(sub.startedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const renewsOn = useMemo(() => sub.renewsOn ? new Date(sub.renewsOn).toISOString().slice(0, 10) : computeRenewsOn(startedAt, months), [sub.renewsOn, startedAt, months]);

  function set(patch) { onChange({ ...sub, ...patch }); }

  function pickPlan(newPlan) {
    const p = PLANS.find(x => x.value === newPlan);
    const m = newPlan === 'custom' ? (sub.customMonths || 1) : p?.months;
    set({ plan: newPlan, renewsOn: computeRenewsOn(sub.startedAt || new Date().toISOString(), m) });
  }
  function setCustomMonths(v) {
    set({ customMonths: Number(v), renewsOn: computeRenewsOn(sub.startedAt || new Date().toISOString(), Number(v)) });
  }
  function setStartedAt(v) {
    set({ startedAt: v, renewsOn: computeRenewsOn(v, months) });
  }
  function setRenewsOn(v) { set({ renewsOn: v }); }

  return (
    <div style={{marginTop: 20, padding: 16, background: '#f0f7ff', border: '1px solid #c7dbf0', borderRadius: 8}}>
      <h4 style={{fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--blue)', marginBottom: 8}}>💳 Subscription</h4>
      <div className="row">
        <div style={{flex: 1}}>
          <label>Plan Duration *</label>
          <select value={plan} onChange={e => pickPlan(e.target.value)}>
            {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        {plan === 'custom' && (
          <div style={{flex: 1}}>
            <label>Custom Months *</label>
            <input type="number" min={1} max={120} value={sub.customMonths || 1} onChange={e => setCustomMonths(e.target.value)} />
          </div>
        )}
        <div style={{flex: 1}}>
          <label>Status</label>
          <select value={sub.status || 'active'} onChange={e => set({ status: e.target.value })}>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <div className="row mt-1">
        <div style={{flex: 1}}>
          <label>Started On</label>
          <input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} />
        </div>
        <div style={{flex: 1}}>
          <label>Renews On {plan !== 'custom' && <span className="text-mut" style={{textTransform: 'none', letterSpacing: 0}}>(auto)</span>}</label>
          <input type="date" value={renewsOn} onChange={e => setRenewsOn(e.target.value)} />
        </div>
        <div style={{flex: 1}}>
          <label>Rate ₹ (per cycle)</label>
          <input type="number" min={0} value={sub.rate || 0} onChange={e => set({ rate: Number(e.target.value) })} placeholder="0" />
        </div>
      </div>
      <p className="text-mut text-sm" style={{marginTop: 8}}>
        {sub.rate > 0 && plan !== 'custom' && `~ ₹${Math.round((sub.rate || 0) / (PLANS.find(p => p.value === plan)?.months || 1)).toLocaleString()} / month · MRR contribution`}
      </p>
    </div>
  );
}
