import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Shell } from '../components/Shell';
import { useAuthStore } from '../store';
import api from '../api/client';

// ════════════════════════════════════════════════════════════
// ONBOARDING PAGE
// ════════════════════════════════════════════════════════════

export function OnboardingPage() {
  const { user, setUser } = useAuthStore();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: user?.name || '', country: 'NG', vName: '', sector: '', stage: 'idea' as const });
  const [loading, setLoading] = useState(false);

  const STEPS = ['Your details', 'Your venture', 'Consent'];
  const COUNTRIES = [['NG','Nigeria'],['KE','Kenya'],['GH','Ghana'],['ZA','South Africa'],['GB','United Kingdom']];
  const SECTORS = ['Fintech','Agritech','Healthtech','Edtech','E-commerce','Logistics','Energy','Other'];

  async function finish() {
    if (!user) return;
    setLoading(true);
    try {
      await api.user.update(user.id, { name: form.name, country: form.country });
      await api.venture.create({ name: form.vName || `${form.name}'s Venture`, sector: form.sector, stage: form.stage, country: form.country });
      await api.user.grantConsent(user.id, 'terms_v2');
      await api.user.grantConsent(user.id, 'privacy_policy');
      const { user: updated } = await api.auth.me();
      setUser({ ...updated, onboardingCompleted: true });
      window.location.href = '/dashboard';
    } catch (e: any) {
      alert(e.response?.data?.title || 'Something went wrong');
    } finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8F7F4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ background: '#0A0A0A', display: 'inline-block', borderRadius: 12, padding: '10px 20px', marginBottom: 12 }}>
            <span style={{ color: '#F5C842', fontSize: 22, fontWeight: 700 }}>IkonetU</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: '0 0 8px' }}>Set up your account</h1>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: i <= step ? '#0A0A0A' : '#E0DED8', color: i <= step ? '#fff' : '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{i + 1}</div>
                <span style={{ fontSize: 12, color: i === step ? '#0A0A0A' : '#888', fontWeight: i === step ? 600 : 400 }}>{s}</span>
                {i < STEPS.length - 1 && <div style={{ width: 24, height: 1, background: '#E0DED8', margin: '0 4px' }} />}
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E0DED8', padding: 32 }}>
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 24px' }}>Tell us about yourself</h2>
              {[
                { label: 'Full name', key: 'name', type: 'text', placeholder: 'Adenola Adegbesan' },
              ].map(f => (
                <div key={f.key} style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{f.label}</label>
                  <input type={f.type} value={form[f.key as keyof typeof form] as string} placeholder={f.placeholder}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' }} />
                </div>
              ))}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Country</label>
                <select value={form.country} onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                  style={{ width: '100%', padding: '11px 14px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 15, background: '#fff' }}>
                  {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 24px' }}>Your venture</h2>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Venture name</label>
                <input value={form.vName} placeholder="e.g. PayStack, Andela, Flutterwave"
                  onChange={e => setForm(p => ({ ...p, vName: e.target.value }))}
                  style={{ width: '100%', padding: '11px 14px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sector</label>
                <select value={form.sector} onChange={e => setForm(p => ({ ...p, sector: e.target.value }))}
                  style={{ width: '100%', padding: '11px 14px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 15, background: '#fff' }}>
                  <option value="">Select sector</option>
                  {SECTORS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Business stage</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[['idea','Idea / Pre-revenue'],['mvp','MVP / Early traction'],['revenue','Revenue stage'],['scaling','Scaling']] .map(([v, l]) => (
                    <button key={v} onClick={() => setForm(p => ({ ...p, stage: v as any }))}
                      style={{ padding: '10px 14px', border: `2px solid ${form.stage === v ? '#C9900C' : '#E0DED8'}`, borderRadius: 8, background: form.stage === v ? '#FAEEDA' : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: form.stage === v ? 600 : 400, color: form.stage === v ? '#C9900C' : '#555' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px' }}>Data consent</h2>
              <p style={{ fontSize: 14, color: '#888', margin: '0 0 20px', lineHeight: 1.7 }}>
                To create your account and calculate your IkonetU Score, we need your consent to process your business data in accordance with our{' '}
                <a href="#" style={{ color: '#C9900C' }}>Privacy Policy</a> and{' '}
                <a href="#" style={{ color: '#C9900C' }}>Terms and Conditions</a>.
              </p>
              {[
                { key: 'terms_v2', label: 'I agree to the Terms and Conditions', required: true },
                { key: 'privacy_policy', label: 'I agree to the Privacy Policy and data processing', required: true },
                { key: 'score_share_investors', label: 'Allow investors to view my score (optional)' },
                { key: 'analytics', label: 'Allow platform analytics to improve the service (optional)' },
              ].map(c => (
                <div key={c.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #F0EDE8' }}>
                  <input type="checkbox" id={c.key} defaultChecked={c.required} style={{ marginTop: 2, accentColor: '#C9900C' }} />
                  <label htmlFor={c.key} style={{ fontSize: 14, color: '#555', cursor: 'pointer', lineHeight: 1.5 }}>
                    {c.label}
                    {c.required && <span style={{ color: '#C9900C', marginLeft: 4 }}>*</span>}
                  </label>
                </div>
              ))}
              <p style={{ fontSize: 12, color: '#aaa', marginTop: 16, lineHeight: 1.6 }}>
                You can withdraw consent at any time from Settings. IkonetU Technology Limited · Registered in England and Wales.
                Contact: <a href="mailto:customer.service@ikonetu.com" style={{ color: '#aaa' }}>customer.service@ikonetu.com</a>
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} style={{ flex: 1, background: '#F8F7F4', border: '1px solid #E0DED8', borderRadius: 10, padding: '13px 20px', fontSize: 15, cursor: 'pointer', color: '#555' }}>
                ← Back
              </button>
            )}
            {step < 2
              ? (
                <button onClick={() => setStep(s => s + 1)} style={{ flex: 1, background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                  Continue →
                </button>
              )
              : (
                <button onClick={finish} disabled={loading} style={{ flex: 1, background: '#C9900C', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Creating account...' : '🚀 Launch my account'}
                </button>
              )
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// SETTINGS PAGE
// ════════════════════════════════════════════════════════════

export function SettingsPage() {
  const { user } = useAuthStore();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(user?.name || '');

  const { data: consentsData, refetch } = useQuery({
    queryKey: ['consents'],
    queryFn: () => api.user.consents(user!.id),
    enabled: !!user,
  });

  async function save() {
    if (!user) return;
    setSaving(true);
    try { await api.user.update(user.id, { name }); } finally { setSaving(false); }
  }

  const SETTINGS_NAV = [
    { label: 'Dashboard', path: '/dashboard', icon: '←' },
    { label: 'Settings',  path: '/settings',  icon: '⚙️' },
    { label: 'Billing',   path: '/billing',   icon: '💳' },
  ];

  return (
    <Shell nav={SETTINGS_NAV} title="Settings">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: '0 0 28px' }}>Account settings</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 20px' }}>Profile</h3>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Email</label>
            <input value={user?.email || ''} disabled style={{ width: '100%', padding: '10px 12px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 14, background: '#F8F7F4', boxSizing: 'border-box' }} />
          </div>
          <button onClick={save} disabled={saving}
            style={{ background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 20px' }}>Data & consent</h3>
          {(consentsData?.consents || []).filter((c: any) => !c.required).map((c: any) => (
            <div key={c.consent_type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0EDE8' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#0A0A0A' }}>{c.description}</div>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'capitalize' }}>{c.lawfulBasis?.replace(/_/g, ' ')}</div>
              </div>
              <button onClick={() => c.granted ? api.user.revokeConsent(user!.id, c.consent_type).then(() => refetch()) : api.user.grantConsent(user!.id, c.consent_type).then(() => refetch())}
                style={{ background: c.granted ? '#EAF3DE' : '#F8F7F4', color: c.granted ? '#27500A' : '#888', border: '1px solid #E0DED8', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                {c.granted ? '✓ Granted' : 'Grant'}
              </button>
            </div>
          ))}
          <div style={{ marginTop: 20, padding: 14, background: '#FEF2F2', borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#991B1B', marginBottom: 4 }}>Delete my account</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>This submits a GDPR Art. 17 deletion request. Your data will be removed within 30 days.</div>
            <button onClick={() => { if (confirm('Submit account deletion request?')) api.user.get(user!.id); }}
              style={{ background: '#FEE2E2', color: '#991B1B', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              Request deletion
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════
// BILLING PAGE
// ════════════════════════════════════════════════════════════

export function BillingPage() {
  const { user } = useAuthStore();
  const BILLING_NAV = [
    { label: 'Dashboard', path: '/dashboard', icon: '←' },
    { label: 'Billing',   path: '/billing',   icon: '💳' },
  ];

  const { data: subData } = useQuery({ queryKey: ['subscription'], queryFn: () => api.billing.subscription() });
  const { data: creditData } = useQuery({ queryKey: ['credits'], queryFn: () => api.billing.credits() });
  const { data: plansData } = useQuery({ queryKey: ['plans'], queryFn: () => api.billing.plans() });
  const { data: invoicesData } = useQuery({ queryKey: ['invoices'], queryFn: () => api.billing.invoices() });

  const sub = subData?.subscription;
  const balances = creditData?.balances ?? [];
  const plans = plansData?.plans ?? [];
  const invoices = invoicesData?.invoices ?? [];

  return (
    <Shell nav={BILLING_NAV} title="Billing">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: '0 0 28px' }}>Billing & plans</h1>

      {/* Current plan */}
      <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>Current plan</h3>
        {sub
          ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0A0A0A' }}>{sub.plan_name}</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                  Renews {new Date(sub.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ background: sub.status === 'active' ? '#EAF3DE' : '#FEF3C7', color: sub.status === 'active' ? '#27500A' : '#92400E', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 99 }}>
                  {sub.status}
                </span>
                <button onClick={() => api.billing.cancel()} style={{ background: '#FEF2F2', color: '#991B1B', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )
          : (
            <div style={{ color: '#888', fontSize: 14 }}>
              You are on the free plan. Upgrade to unlock advanced features.
            </div>
          )
        }
      </div>

      {/* Credits */}
      {balances.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>Credit balances</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {balances.map((b: any) => (
              <div key={b.credit_type} style={{ background: '#F8F7F4', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0A0A0A' }}>{b.balance}</div>
                <div style={{ fontSize: 12, color: '#888', textTransform: 'capitalize', marginTop: 4 }}>{b.credit_type.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>Invoice history</h3>
          {invoices.slice(0, 10).map((inv: any) => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0EDE8', fontSize: 14 }}>
              <span style={{ color: '#555' }}>{new Date(inv.created_at).toLocaleDateString('en-GB')}</span>
              <span style={{ fontWeight: 600 }}>£{parseFloat(inv.amount).toFixed(2)}</span>
              <span style={{ color: inv.status === 'paid' ? '#059669' : '#F59E0B', fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{inv.status}</span>
              {inv.pdf_url && <a href={inv.pdf_url} target="_blank" style={{ fontSize: 12, color: '#888' }}>PDF</a>}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

// Score detail page
export function ScoreDetailPage() {
  return <div style={{ padding: 40, color: '#888', fontSize: 16 }}>Score detail view — coming in next sprint.</div>;
}
