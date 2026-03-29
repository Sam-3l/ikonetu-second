import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Shell, StatCard, TierBadge } from '../components/Shell';
import { useAuthStore } from '../store';
import api from '../api/client';

// ════════════════════════════════════════════════════════════
// INVESTOR DASHBOARD
// ════════════════════════════════════════════════════════════

const INV_NAV = [
  { label: 'Matches',    path: '/dashboard',       icon: '🎯' },
  { label: 'Deal Rooms', path: '/dashboard#rooms',  icon: '🏛️' },
  { label: 'Billing',    path: '/billing',          icon: '💳' },
];

export function InvestorDashboard() {
  const { user } = useAuthStore();
  const [introducing, setIntroducing] = useState<string | null>(null);

  const { data: matchesData, refetch } = useQuery({
    queryKey: ['investor-matches'],
    queryFn: () => api.investor.matches(),
    enabled: !!user,
  });

  const { data: roomsData } = useQuery({
    queryKey: ['deal-rooms'],
    queryFn: () => api.investor.dealRooms(),
    enabled: !!user,
  });

  const { data: creditsData } = useQuery({
    queryKey: ['credits'],
    queryFn: () => api.billing.credits(),
    enabled: !!user,
  });

  const matches = matchesData?.matches ?? [];
  const rooms = roomsData?.dealRooms ?? [];
  const introCreds = creditsData?.balances?.find((b: any) => b.credit_type === 'introductions')?.balance ?? 0;

  async function introduce(matchId: string) {
    setIntroducing(matchId);
    try {
      await api.investor.introduce(matchId);
      refetch();
    } catch (e: any) {
      alert(e.response?.data?.title || 'Failed to send introduction');
    } finally { setIntroducing(null); }
  }

  return (
    <Shell nav={INV_NAV} title="Investor Dashboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: 0 }}>Founder matches</h1>
        <div style={{ background: '#EFF6FF', border: '1px solid #B5D4F4', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#0C447C' }}>
          💬 {introCreds} introduction credit{introCreds !== 1 ? 's' : ''} remaining
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total matches" value={matches.length} />
        <StatCard label="Introductions sent" value={matches.filter((m: any) => m.status === 'introduced').length} color="#1D4ED8" />
        <StatCard label="Deal rooms" value={rooms.length} />
        <StatCard label="Credits" value={introCreds} sub="introductions left" />
      </div>

      {matches.length === 0
        ? (
          <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0A0A0A', marginBottom: 8 }}>No matches yet</h3>
            <p style={{ color: '#888', fontSize: 14 }}>Update your investment thesis in Settings to see founders that match your criteria.</p>
          </div>
        )
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {matches.map((m: any) => (
              <div key={m.venture_id} style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', marginBottom: 4 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{m.sector} · {m.country} · {m.stage}</div>
                  </div>
                  <TierBadge tier={m.tier} />
                </div>
                <div style={{ background: '#F8F7F4', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: '#888' }}>IkonetU Score</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#0A0A0A' }}>{m.total_score}</span>
                  </div>
                  <div style={{ height: 4, background: '#E0DED8', borderRadius: 99, marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ height: 4, width: `${m.total_score / 10}%`, background: '#1D4ED8', borderRadius: 99 }} />
                  </div>
                </div>
                {m.status === 'introduced'
                  ? <div style={{ textAlign: 'center', fontSize: 13, color: '#888', padding: '8px 0' }}>✅ Introduction sent</div>
                  : (
                    <button onClick={() => introduce(m.id || m.venture_id)} disabled={introducing === (m.id || m.venture_id) || introCreds === 0}
                      style={{ width: '100%', background: introCreds > 0 ? '#1D4ED8' : '#E8E6E0', color: introCreds > 0 ? '#fff' : '#888', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: introCreds > 0 ? 'pointer' : 'not-allowed' }}>
                      {introducing === (m.id || m.venture_id) ? 'Sending...' : '→ Request Introduction (1 credit)'}
                    </button>
                  )
                }
              </div>
            ))}
          </div>
        )
      }
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════
// PROVIDER DASHBOARD
// ════════════════════════════════════════════════════════════

const PROV_NAV = [
  { label: 'Matches',  path: '/dashboard',      icon: '🎯' },
  { label: 'Bookings', path: '/dashboard#book',  icon: '📅' },
  { label: 'Billing',  path: '/billing',         icon: '💳' },
];

export function ProviderDashboard() {
  const { user } = useAuthStore();
  const [connecting, setConnecting] = useState<string | null>(null);

  const { data: matchesData, refetch } = useQuery({
    queryKey: ['provider-matches'],
    queryFn: () => api.provider.matches(),
    enabled: !!user,
  });

  const { data: creditsData } = useQuery({
    queryKey: ['credits'],
    queryFn: () => api.billing.credits(),
    enabled: !!user,
  });

  const matches = matchesData?.matches ?? [];
  const leadCreds = creditsData?.balances?.find((b: any) => b.credit_type === 'leads')?.balance ?? 0;

  async function connect(matchId: string) {
    setConnecting(matchId);
    try {
      await api.provider.connect(matchId);
      refetch();
    } catch (e: any) { alert(e.response?.data?.title || 'Failed'); }
    finally { setConnecting(null); }
  }

  return (
    <Shell nav={PROV_NAV} title="Provider Dashboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: 0 }}>Founder leads</h1>
        <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#065F46' }}>
          ⚡ {leadCreds} lead credit{leadCreds !== 1 ? 's' : ''} remaining
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Available leads" value={matches.length} />
        <StatCard label="Connected" value={matches.filter((m: any) => m.status === 'accepted').length} color="#059669" />
        <StatCard label="Lead credits" value={leadCreds} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {matches.map((m: any) => (
          <div key={m.venture_id} style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 14, padding: 20 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', marginBottom: 3 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{m.sector} · {m.country}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div style={{ flex: 1, background: '#F8F7F4', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>IKU Score</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{m.total_score}</div>
              </div>
              <div style={{ flex: 1, background: '#FEF2F2', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Score gap</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#EF4444' }}>-{m.score_gap}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
              Needs help with: <span style={{ color: '#059669', fontWeight: 600, textTransform: 'capitalize' }}>{m.category?.replace(/_/g, ' ')}</span>
            </div>
            <button onClick={() => connect(m.id)} disabled={!!connecting || leadCreds === 0}
              style={{ width: '100%', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Connect (1 credit)
            </button>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════
// LENDER DASHBOARD
// ════════════════════════════════════════════════════════════

const LEND_NAV = [
  { label: 'Borrower pool', path: '/dashboard',      icon: '👥' },
  { label: 'Portfolio',     path: '/dashboard#port',  icon: '📊' },
  { label: 'Alerts',        path: '/dashboard#alert', icon: '🔔' },
];

export function LenderDashboard() {
  const { user } = useAuthStore();

  const { data: poolData } = useQuery({
    queryKey: ['borrower-pool'],
    queryFn: () => api.lender.borrowerPool(),
    enabled: !!user,
  });

  const { data: alertsData } = useQuery({
    queryKey: ['lender-alerts'],
    queryFn: () => api.lender.alerts(),
    enabled: !!user,
  });

  const pool = poolData?.pool ?? [];
  const alerts = alertsData?.alerts ?? [];

  return (
    <Shell nav={LEND_NAV} title="Lender Dashboard">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: '0 0 28px' }}>Pre-qualified borrowers</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="In pool" value={pool.length} />
        <StatCard label="Grade A" value={pool.filter((p: any) => p.bankability_score >= 80).length} color="#7C3AED" sub="bankability ≥ 80" />
        <StatCard label="Avg bankability" value={pool.length > 0 ? Math.round(pool.reduce((s: number, p: any) => s + p.bankability_score, 0) / pool.length) : 0} sub="/ 100" />
        <StatCard label="Unread alerts" value={alerts.length} color={alerts.length > 0 ? '#EF4444' : '#888'} />
      </div>

      {alerts.length > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#991B1B', margin: '0 0 12px' }}>🔔 Portfolio alerts ({alerts.length})</h3>
          {alerts.slice(0, 3).map((a: any) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #FCA5A5', fontSize: 13 }}>
              <span><strong>{a.venture_name}</strong> — {a.alert_type.replace(/_/g, ' ')}</span>
              <span style={{ color: a.severity === 'critical' ? '#EF4444' : '#F59E0B', fontSize: 11, fontWeight: 600 }}>{a.severity.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8F7F4', borderBottom: '1px solid #E8E6E0' }}>
              {['Venture', 'Country', 'Sector', 'IKU Score', 'Bankability', 'Grade', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pool.slice(0, 20).map((p: any) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #F0EDE8' }}>
                <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#888' }}>{p.country}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#888' }}>{p.sector}</td>
                <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600 }}>{p.iku_score}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: '#E8E6E0', borderRadius: 99, overflow: 'hidden', minWidth: 60 }}>
                      <div style={{ height: 6, width: `${p.bankability_score}%`, background: '#7C3AED', borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 28 }}>{Math.round(p.bankability_score)}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: p.bankability_score >= 80 ? '#EDE9FE' : '#F3F4F6', color: p.bankability_score >= 80 ? '#7C3AED' : '#888', fontWeight: 700, fontSize: 13, padding: '2px 10px', borderRadius: 99 }}>
                    {p.bankability_score >= 80 ? 'A' : p.bankability_score >= 60 ? 'B' : p.bankability_score >= 40 ? 'C' : 'D'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => api.lender.addToPortfolio(p.id)}
                    style={{ background: 'none', border: '1px solid #7C3AED', color: '#7C3AED', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
                    + Monitor
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════
// UNIVERSITY DASHBOARD
// ════════════════════════════════════════════════════════════

const UNI_NAV = [
  { label: 'My founders', path: '/dashboard',         icon: '🎓' },
  { label: 'Rankings',    path: '/dashboard#rankings', icon: '🏆' },
];

export function UniversityDashboard() {
  const { user } = useAuthStore();

  const { data: foundersData } = useQuery({
    queryKey: ['uni-founders'],
    queryFn: () => api.university.founders(),
    enabled: !!user,
  });

  const { data: rankingsData } = useQuery({
    queryKey: ['uni-rankings'],
    queryFn: () => api.university.rankings(),
  });

  const founders = foundersData?.founders ?? [];
  const summary  = foundersData?.summary;
  const rankings = rankingsData?.rankings ?? [];

  return (
    <Shell nav={UNI_NAV} title="University Dashboard">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: '0 0 28px' }}>Your entrepreneurial alumni</h1>
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
          <StatCard label="Total founders" value={summary.total} />
          <StatCard label="Avg IKU score" value={summary.avgScore} sub="out of 1,000" color="#DC2626" />
          <StatCard label="Investable+" value={(summary.byTier?.INVESTABLE || 0) + (summary.byTier?.ELITE || 0)} sub="score 601–1000" />
          <StatCard label="Elite tier" value={summary.byTier?.ELITE || 0} sub="score 851–1000" color="#C9900C" />
        </div>
      )}
      <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>Your founders</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E8E6E0' }}>
              {['Venture', 'Country', 'Sector', 'Score', 'Tier'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {founders.slice(0, 20).map((f: any) => (
              <tr key={f.id} style={{ borderBottom: '1px solid #F0EDE8' }}>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 500 }}>{f.name}</td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#888' }}>{f.country}</td>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#888' }}>{f.sector}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>{f.total_score ?? '—'}</td>
                <td style={{ padding: '10px 12px' }}>{f.tier ? <TierBadge tier={f.tier} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════
// GOLDEN EYE — ADMIN DASHBOARD
// LIGHT MODE ONLY. NO DARK MODE. EVER.
// ════════════════════════════════════════════════════════════

const ADMIN_NAV = [
  { label: 'Overview',      path: '/admin',               icon: '👁️' },
  { label: 'Users',         path: '/admin/users',         icon: '👥' },
  { label: 'Ventures',      path: '/admin/ventures',      icon: '🚀' },
  { label: 'Verification',  path: '/admin/verification',  icon: '✅' },
  { label: 'Scoring',       path: '/admin/scoring',       icon: '🎯' },
  { label: 'Revenue',       path: '/admin/revenue',       icon: '💰' },
  { label: 'ACXM',          path: '/admin/acxm',          icon: '⚡' },
  { label: 'Compliance',    path: '/admin/compliance',    icon: '🔒' },
  { label: 'Config',        path: '/admin/config',        icon: '⚙️' },
];

export default function GoldenEye() {
  const { user } = useAuthStore();

  const { data: dash } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api.admin.dashboard(),
    refetchInterval: 30_000, // refresh every 30s
  });

  const { data: queue } = useQuery({
    queryKey: ['verification-queue'],
    queryFn: () => api.admin.verificationQueue(),
    refetchInterval: 60_000,
  });

  const { data: escalations } = useQuery({
    queryKey: ['acxm-escalations'],
    queryFn: () => api.admin.acxmEscalations(),
    refetchInterval: 60_000,
  });

  const docs = queue?.queue ?? [];
  const escs = escalations?.escalations ?? [];

  return (
    <Shell nav={ADMIN_NAV} title="Golden Eye">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 22 }}>👁️</span>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0A0A0A', margin: 0 }}>Golden Eye</h1>
            <span style={{ background: '#0A0A0A', color: '#F5C842', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, letterSpacing: '0.06em' }}>
              LIGHT MODE ONLY
            </span>
          </div>
          <p style={{ color: '#888', fontSize: 13, margin: 0 }}>
            Last updated {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · Auto-refreshes every 30s
          </p>
        </div>
      </div>

      {/* Urgent alerts */}
      {(escs.length > 0 || docs.length > 0 || (dash?.compliance?.pendingGdprRequests ?? 0) > 0) && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#991B1B', marginBottom: 8 }}>⚠️ Action required</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {escs.length > 0 && <span style={{ fontSize: 13, color: '#DC2626' }}>{escs.length} ACXM escalation{escs.length > 1 ? 's' : ''} pending review</span>}
            {docs.length > 0 && <span style={{ fontSize: 13, color: '#B45309' }}>{docs.length} document{docs.length > 1 ? 's' : ''} awaiting verification</span>}
            {(dash?.compliance?.pendingGdprRequests ?? 0) > 0 && <span style={{ fontSize: 13, color: '#991B1B' }}>{dash?.compliance?.pendingGdprRequests} GDPR request{dash?.compliance?.pendingGdprRequests > 1 ? 's' : ''} pending</span>}
          </div>
        </div>
      )}

      {/* Real-time metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total users" value={dash?.platform?.totalUsers?.toLocaleString() ?? '—'} />
        <StatCard label="New today" value={dash?.platform?.newUsersToday ?? '—'} color="#1D4ED8" />
        <StatCard label="Active subs" value={dash?.platform?.activeSubscriptions ?? '—'} color="#059669" />
        <StatCard label="Revenue today" value={dash?.revenue?.today != null ? `£${dash.revenue.today.toFixed(0)}` : '—'} color="#C9900C" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
        <StatCard label="MTD revenue" value={dash?.revenue?.mtd != null ? `£${Math.round(dash.revenue.mtd).toLocaleString()}` : '—'} color="#C9900C" />
        <StatCard label="Scores today" value={dash?.scoring?.calculatedToday ?? '—'} />
        <StatCard label="ACXM opps" value={dash?.acxm?.openOpportunities ?? '—'} color="#059669" />
        <StatCard label="ACXM threats" value={dash?.acxm?.openThreats ?? '—'} color={dash?.acxm?.openThreats > 0 ? '#EF4444' : '#888'} />
      </div>

      {/* Verification queue */}
      {docs.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: '0 0 16px' }}>
            Document verification queue ({docs.length})
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8F7F4', borderBottom: '1px solid #E8E6E0' }}>
                {['Founder', 'Venture', 'Document type', 'Uploaded', 'Verify as'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.slice(0, 10).map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #F0EDE8' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{d.founder_name}<br/><span style={{ color: '#888', fontSize: 11 }}>{d.founder_email}</span></td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{d.venture_name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{d.document_type?.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#888' }}>{new Date(d.created_at).toLocaleDateString('en-GB')}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[3, 2, 1].map(t => (
                        <button key={t} onClick={() => api.admin.approveDocument(d.venture_id, d.id, t)}
                          style={{ background: '#EAF3DE', color: '#27500A', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                          Tier {t}
                        </button>
                      ))}
                      <button onClick={() => api.admin.rejectDocument?.(d.venture_id, d.id, 'Does not meet requirements')}
                        style={{ background: '#FEE2E2', color: '#991B1B', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ACXM escalations */}
      {escs.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: '0 0 16px' }}>
            ACXM escalations requiring human review ({escs.length})
          </h3>
          {escs.slice(0, 5).map((e: any) => (
            <div key={e.id} style={{ border: '1px solid #E8E6E0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>{e.signal_type?.replace(/\./g, ' › ')}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: e.severity === 'critical' ? '#FEE2E2' : '#FEF3C7', color: e.severity === 'critical' ? '#991B1B' : '#92400E' }}>
                    {e.severity?.toUpperCase()}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: '#888' }}>{new Date(e.escalated_at).toLocaleString('en-GB')}</span>
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>{e.name} · {e.email}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => api.admin.resolveEscalation(e.id, 'Reviewed and actioned', true)}
                  style={{ background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  ✅ Action & resolve
                </button>
                <button onClick={() => api.admin.resolveEscalation(e.id, 'Reviewed — no action required', false)}
                  style={{ background: '#F8F7F4', color: '#555', border: '1px solid #E0DED8', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
