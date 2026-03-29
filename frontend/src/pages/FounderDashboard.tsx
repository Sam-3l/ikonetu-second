import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shell, ScoreMeter, StatCard, CategoryBar, TierBadge, NotificationBell } from '../components/Shell';
import { useAuthStore } from '../store';
import api from '../api/client';
import type { Tier } from '../api/client';

const NAV = [
  { label: 'Dashboard',   path: '/dashboard',       icon: '📊' },
  { label: 'Score',       path: '/score/mine',       icon: '🎯' },
  { label: 'Documents',   path: '/dashboard#docs',   icon: '📄' },
  { label: 'Marketplace', path: '/dashboard#market', icon: '🛒' },
];

const CATEGORY_COLORS: Record<string, string> = {
  identity: '#3B82F6', financial: '#10B981', media: '#8B5CF6',
  product: '#F59E0B', team: '#EC4899', legal: '#14B8A6',
  market: '#F97316', operations: '#6B7280',
};

export default function FounderDashboard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('business_registration');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me(),
  });

  const { data: ventureData, refetch: refetchVenture } = useQuery({
    queryKey: ['my-venture'],
    queryFn: async () => {
      const res = await api.venture.create({
        name: user?.name + "'s Venture",
        stage: 'idea',
      }).catch(() => null);
      return res;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const ventureId = ventureData?.venture?.id;

  const { data: scoreData, refetch: refetchScore } = useQuery({
    queryKey: ['score', ventureId],
    queryFn: () => api.scoring.getScore(ventureId!),
    enabled: !!ventureId,
  });

  const { data: actionsData } = useQuery({
    queryKey: ['next-actions', ventureId],
    queryFn: () => api.scoring.nextActions(ventureId!),
    enabled: !!ventureId,
  });

  const { data: docsData, refetch: refetchDocs } = useQuery({
    queryKey: ['docs', ventureId],
    queryFn: () => api.venture.documents(ventureId!),
    enabled: !!ventureId,
  });

  const calcMutation = useMutation({
    mutationFn: () => api.scoring.calculate(ventureId!),
    onSuccess: () => { refetchScore(); qc.invalidateQueries({ queryKey: ['next-actions'] }); },
  });

  const score = scoreData?.score;
  const hasScore = scoreData?.hasScore;
  const tier: Tier = score?.tier ?? 'EARLY';
  const totalScore = score?.totalScore ?? 0;
  const categories = score?.categories ?? [];
  const nextActions = actionsData?.nextActions ?? [];
  const docs = docsData?.documents ?? [];

  async function uploadDocument(file: File) {
    if (!ventureId) return;
    setUploadingDoc(true);
    try {
      await api.venture.uploadDocument(ventureId, file, docType);
      refetchDocs();
    } catch (e: any) {
      alert(e.response?.data?.title || 'Upload failed');
    } finally { setUploadingDoc(false); }
  }

  async function runScoutScan() {
    if (!ventureId) return;
    setScanning(true); setScanStatus('Starting scan...');
    try {
      await api.scout.scan(ventureId);
      setScanStatus('Scan running — checking status...');
      // Poll for completion
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const status = await api.scout.status(ventureId);
        setScanStatus(`Scanning: ${Object.entries(status.sources || {}).map(([k,v]) => `${k}: ${v}`).join(' | ')}`);
        if (status.status === 'completed') {
          setScanStatus(`✅ Scan complete — ${status.signalsFound} signals found`);
          refetchScore();
          break;
        }
        if (status.status === 'failed') { setScanStatus('Scan failed. Try again.'); break; }
      }
    } catch (e) {
      setScanStatus('Scan failed. Check your internet connection.');
    } finally { setScanning(false); }
  }

  return (
    <Shell nav={NAV} title="Founder Dashboard">

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0A0A0A', margin: '0 0 4px' }}>
            {hasScore ? 'Your IkonetU Score' : 'Welcome to IkonetU'}
          </h1>
          <p style={{ color: '#888', fontSize: 14, margin: 0 }}>
            {hasScore ? `Last updated ${new Date(score!.scoredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : 'Complete your profile and calculate your first score'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user && <NotificationBell userId={user.id} />}
          <button onClick={() => calcMutation.mutate()} disabled={calcMutation.isPending || !ventureId}
            style={{ background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: calcMutation.isPending ? 0.6 : 1 }}>
            {calcMutation.isPending ? 'Calculating...' : '↻ Calculate Score'}
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, marginBottom: 28 }}>

        {/* Score meter */}
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <ScoreMeter score={totalScore} tier={tier} size={200} />
          {score?.nextTier && (
            <div style={{ background: '#FAEEDA', borderRadius: 8, padding: '10px 16px', width: '100%', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Next tier</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#C9900C' }}>
                +{score.nextTier.pointsNeeded} points to {score.nextTier.tier}
              </div>
            </div>
          )}
          <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>
            Confidence: <span style={{ fontWeight: 600, color: '#0A0A0A' }}>{score?.confidencePct ?? 0}%</span>
          </div>
        </div>

        {/* Categories */}
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: '0 0 20px' }}>Score breakdown by category</h3>
          {categories.length === 0
            ? <div style={{ color: '#aaa', fontSize: 14, paddingTop: 20 }}>Calculate your score to see the breakdown</div>
            : categories.map((c: any) => (
              <CategoryBar key={c.category} label={c.category} score={c.score} max={c.maxPossible} color={CATEGORY_COLORS[c.category] || '#C9900C'} />
            ))
          }
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="IkonetU Score" value={totalScore} sub="out of 1,000" color={totalScore >= 601 ? '#10B981' : totalScore >= 301 ? '#F59E0B' : '#94A3B8'} />
        <StatCard label="Tier" value={tier === 'EARLY' ? 'Early Stage' : tier === 'RISING' ? 'Rising' : tier === 'INVESTABLE' ? 'Investable' : 'Elite'} color="#C9900C" />
        <StatCard label="Documents" value={docs.filter((d: any) => d.verified).length} sub={`${docs.length} total uploaded`} />
        <StatCard label="Signals found" value={categories.reduce((s: number, c: any) => s + (c.signalsFound || 0), 0)} sub="across all categories" />
      </div>

      {/* Next best actions */}
      {nextActions.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: '0 0 16px' }}>Your highest-impact next actions</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {nextActions.map((a: any) => (
              <div key={a.id} style={{ border: '1px solid #E8E6E0', borderRadius: 10, padding: 16, background: '#FAFAF8' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>{a.title}</span>
                  <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap', marginLeft: 8 }}>
                    +{a.estimatedPoints} pts
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#888', margin: 0, lineHeight: 1.5 }}>{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document upload + Scout scan */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Document upload */}
        <div id="docs" style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: '0 0 16px' }}>Upload verification documents</h3>
          <select value={docType} onChange={e => setDocType(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 14, marginBottom: 12, background: '#fff' }}>
            <option value="business_registration">Business registration certificate</option>
            <option value="government_id">Government ID</option>
            <option value="tax_return">Tax return</option>
            <option value="bank_statement">Bank statement</option>
            <option value="audited_accounts">Audited accounts</option>
            <option value="customer_contracts">Customer contracts</option>
          </select>
          <input ref={fileRef} type="file" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && uploadDocument(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploadingDoc || !ventureId}
            style={{ width: '100%', background: uploadingDoc ? '#E8E6E0' : '#F8F7F4', border: '2px dashed #E0DED8', borderRadius: 10, padding: '20px 16px', cursor: 'pointer', color: '#555', fontSize: 14 }}>
            {uploadingDoc ? 'Uploading...' : '📄 Click to upload document'}
          </button>
          {docs.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {docs.slice(0, 5).map((d: any) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #F0EDE8', fontSize: 13 }}>
                  <span>{d.verified ? '✅' : '⏳'}</span>
                  <span style={{ color: '#555', textTransform: 'capitalize' }}>{d.document_type.replace(/_/g, ' ')}</span>
                  {d.verification_tier && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>Tier {d.verification_tier}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scout scan */}
        <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 16, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', margin: '0 0 8px' }}>Automated data discovery</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px', lineHeight: 1.6 }}>
            Scout automatically verifies your business via Google Maps, Companies House, social media, and Gemini AI classification.
          </p>
          <div style={{ background: '#F8F7F4', borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.7 }}>
            {[
              { icon: '🗺️', label: 'Google Maps listing', tier: 'Tier 2' },
              { icon: '🏛️', label: 'Companies House (UK)', tier: 'Tier 1' },
              { icon: '📱', label: 'Social media profiles', tier: 'Tier 2' },
              { icon: '🤖', label: 'Gemini AI classification', tier: 'Tier 3' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span>{s.icon}</span>
                <span style={{ color: '#555' }}>{s.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888', background: '#E8E6E0', padding: '1px 6px', borderRadius: 4 }}>{s.tier}</span>
              </div>
            ))}
          </div>
          {scanStatus && (
            <div style={{ background: '#EAF3DE', border: '1px solid #C0DD97', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#27500A', marginBottom: 12 }}>
              {scanStatus}
            </div>
          )}
          <button onClick={runScoutScan} disabled={scanning || !ventureId}
            style={{ width: '100%', background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: scanning ? 'wait' : 'pointer', opacity: scanning ? 0.6 : 1 }}>
            {scanning ? 'Scanning...' : '🔍 Run Scout scan'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
