import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, LineElement, PointElement,
  LinearScale, CategoryScale, Filler, Tooltip,
} from 'chart.js';
import { Shell, ScoreMeter, TierBadge, CategoryBar } from '../components/Shell';
import { SectionBoundary } from '../components/ErrorBoundary';
import { useAuthStore, TIER_COLORS } from '../store';
import api from '../api/client';
import type { Tier } from '../api/client';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

const NAV = [
  { label: '← Dashboard', path: '/dashboard',  icon: '' },
  { label: 'Score',        path: '/score/mine', icon: '🎯' },
  { label: 'Billing',      path: '/billing',    icon: '💳' },
];

const CAT_COLORS: Record<string, string> = {
  identity:'#3B82F6', financial:'#10B981', media:'#8B5CF6',
  product:'#F59E0B', team:'#EC4899', legal:'#14B8A6',
  market:'#F97316', operations:'#6B7280',
};

const VT: Record<number, { label: string; color: string; bg: string }> = {
  1:{ label:'Gov. API',         color:'#065F46', bg:'#ECFDF5' },
  2:{ label:'Third-party API',  color:'#1E40AF', bg:'#EFF6FF' },
  3:{ label:'Doc. verified',    color:'#92400E', bg:'#FEF3C7' },
  4:{ label:'Self-declared',    color:'#6B7280', bg:'#F3F4F6' },
};

type Tab = 'breakdown' | 'signals' | 'history' | 'actions';

export default function ScoreDetailFull() {
  const { ventureId: paramId } = useParams<{ ventureId: string }>();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('breakdown');

  const { data: myVenture } = useQuery({
    queryKey: ['my-venture-id'],
    queryFn: async () => {
      const res = await api.venture.create({ name: user?.name + "'s Venture", stage:'idea' }).catch(() => null);
      return res?.venture?.id ?? null;
    },
    enabled: paramId === 'mine' && !!user,
    staleTime: 300_000,
  });

  const ventureId = paramId === 'mine' ? myVenture : paramId;

  const { data: sd, isLoading } = useQuery({
    queryKey: ['score-detail', ventureId],
    queryFn: () => api.scoring.getScore(ventureId!),
    enabled: !!ventureId,
  });

  const { data: hd } = useQuery({
    queryKey: ['score-history', ventureId],
    queryFn: () => api.scoring.history(ventureId!),
    enabled: !!ventureId,
  });

  const { data: ad } = useQuery({
    queryKey: ['next-actions', ventureId],
    queryFn: () => api.scoring.nextActions(ventureId!),
    enabled: !!ventureId,
  });

  const { data: bd } = useQuery({
    queryKey: ['bankability', ventureId],
    queryFn: () => api.bankability.get(ventureId!),
    enabled: !!ventureId,
  });

  const calc = useMutation({
    mutationFn: () => api.scoring.calculate(ventureId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['score-detail', ventureId] });
      qc.invalidateQueries({ queryKey: ['score-history', ventureId] });
      qc.invalidateQueries({ queryKey: ['next-actions', ventureId] });
    },
  });

  const reportDl = useMutation({
    mutationFn: () => api.report.founderScore(ventureId!),
    onSuccess: (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `ikonetu-score-${ventureId}.pdf`;
      a.click(); URL.revokeObjectURL(url);
    },
  });

  const score   = sd?.score;
  const hist    = hd?.history ?? [];
  const actions = ad?.nextActions ?? [];
  const tier: Tier = score?.tier ?? 'EARLY';
  const tc = TIER_COLORS[tier];

  const chartData = {
    labels: hist.map((h: any) =>
      new Date(h.snapshot_date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
    ),
    datasets: [{
      data: hist.map((h: any) => h.total_score),
      borderColor: tc, backgroundColor: tc + '20',
      fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: tc,
    }],
  };

  if (isLoading || !ventureId) {
    return (
      <Shell nav={NAV} title="Score">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:400, color:'#888' }}>
          Loading...
        </div>
      </Shell>
    );
  }

  return (
    <Shell nav={NAV} title="IkonetU Score">

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:700, color:'#0A0A0A', margin:'0 0 6px' }}>IkonetU Score</h1>
          {score && (
            <p style={{ color:'#888', fontSize:13, margin:0 }}>
              Calculated {new Date(score.scoredAt).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}
              {' · '}Confidence {Math.round(score.confidencePct)}%
            </p>
          )}
        </div>
        <div style={{ display:'flex', gap:10 }}>
          {score && (
            <button onClick={() => reportDl.mutate()} disabled={reportDl.isPending}
              style={{ background:'#F8F7F4', border:'1px solid #E0DED8', borderRadius:8, padding:'9px 16px', fontSize:13, cursor:'pointer', color:'#555' }}>
              {reportDl.isPending ? 'Generating…' : '📄 PDF report'}
            </button>
          )}
          <button onClick={() => calc.mutate()} disabled={calc.isPending || !ventureId}
            style={{ background:'#0A0A0A', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontWeight:600, cursor:'pointer', opacity: calc.isPending ? 0.6 : 1 }}>
            {calc.isPending ? 'Calculating…' : '↻ Recalculate'}
          </button>
        </div>
      </div>

      {!sd?.hasScore ? (
        <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, padding:60, textAlign:'center' }}>
          <div style={{ fontSize:48, marginBottom:20 }}>🎯</div>
          <h2 style={{ fontSize:20, fontWeight:700, color:'#0A0A0A', marginBottom:10 }}>No score yet</h2>
          <p style={{ color:'#888', fontSize:14, maxWidth:380, margin:'0 auto 24px' }}>
            Upload verification documents and connect your social profiles to generate your first score.
          </p>
          <button onClick={() => calc.mutate()} disabled={calc.isPending}
            style={{ background:'#0A0A0A', color:'#fff', border:'none', borderRadius:10, padding:'13px 28px', fontSize:15, fontWeight:600, cursor:'pointer' }}>
            {calc.isPending ? 'Calculating…' : 'Calculate my score'}
          </button>
        </div>
      ) : (
        <>
          {/* Hero row */}
          <div style={{ display:'grid', gridTemplateColumns:'260px 1fr', gap:20, marginBottom:20 }}>

            <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, padding:24, display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
              <ScoreMeter score={score!.totalScore} tier={tier} size={200} />
              <TierBadge tier={tier} />
              {score?.nextTier && (
                <div style={{ background:'#FAEEDA', borderRadius:8, padding:'10px 16px', width:'100%' }}>
                  <div style={{ fontSize:11, color:'#888', marginBottom:3, textTransform:'uppercase', letterSpacing:'.05em' }}>Next tier</div>
                  <div style={{ fontSize:14, fontWeight:600, color:'#C9900C' }}>
                    +{score.nextTier.pointsNeeded} pts → {score.nextTier.tier}
                  </div>
                </div>
              )}
              {bd?.hasScore && (
                <div style={{ background:'#EFF6FF', borderRadius:8, padding:'10px 16px', width:'100%' }}>
                  <div style={{ fontSize:11, color:'#888', marginBottom:3, textTransform:'uppercase', letterSpacing:'.05em' }}>Bankability</div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:22, fontWeight:700, color:'#1D4ED8' }}>
                      {Math.round(bd.totalScore)}<span style={{ fontSize:12, fontWeight:400, color:'#888' }}>/100</span>
                    </span>
                    <span style={{ background:'#1D4ED8', color:'#fff', fontSize:13, fontWeight:700, padding:'3px 10px', borderRadius:99 }}>
                      {bd.grade}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <SectionBoundary label="Score history chart">
              <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, padding:24 }}>
                <h3 style={{ fontSize:14, fontWeight:600, color:'#0A0A0A', margin:'0 0 16px' }}>
                  Score progression ({hist.length} snapshot{hist.length !== 1 ? 's' : ''})
                </h3>
                {hist.length >= 2 ? (
                  <div style={{ height:220 }}>
                    <Line data={chartData} options={{
                      responsive:true, maintainAspectRatio:false,
                      plugins:{ legend:{ display:false } },
                      scales:{
                        y:{ min:0, max:1000, grid:{ color:'#F0EDE8' }, ticks:{ color:'#888', font:{ size:11 } } },
                        x:{ grid:{ display:false }, ticks:{ color:'#888', font:{ size:11 } } },
                      },
                    }} />
                  </div>
                ) : (
                  <div style={{ height:220, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#aaa', gap:8 }}>
                    <span style={{ fontSize:32 }}>📈</span>
                    <span style={{ fontSize:13 }}>History builds after your second calculation</span>
                  </div>
                )}
                {hist.length >= 2 && (() => {
                  const d = hist[hist.length-1].total_score - hist[0].total_score;
                  return (
                    <div style={{ display:'flex', gap:24, marginTop:14, paddingTop:14, borderTop:'1px solid #F0EDE8' }}>
                      {[
                        { l:'Starting', v: hist[0].total_score, c:'#888' },
                        { l:'Current',  v: hist[hist.length-1].total_score, c:'#0A0A0A' },
                        { l:'Change',   v: `${d>0?'+':''}${d}`, c: d>0?'#10B981':d<0?'#EF4444':'#888' },
                      ].map(s => (
                        <div key={s.l}>
                          <div style={{ fontSize:11, color:'#888', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:2 }}>{s.l}</div>
                          <div style={{ fontSize:20, fontWeight:700, color:s.c }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </SectionBoundary>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', marginBottom:16, background:'#fff', border:'1px solid #E8E6E0', borderRadius:10, overflow:'hidden', width:'fit-content' }}>
            {([['breakdown','Category breakdown'],['signals','Signals'],['history','History table'],['actions','Next actions']] as const).map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ background: tab===t ? '#0A0A0A' : 'transparent', color: tab===t ? '#fff' : '#555', border:'none', padding:'9px 20px', fontSize:13, fontWeight: tab===t ? 600 : 400, cursor:'pointer' }}>
                {l}
              </button>
            ))}
          </div>

          {/* Breakdown */}
          {tab === 'breakdown' && (
            <SectionBoundary label="Category breakdown">
              <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, padding:28 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:28 }}>
                  {[0,1].map(half => (
                    <div key={half}>
                      {(score!.categories ?? []).slice(half*4, half*4+4).map((c: any) => (
                        <div key={c.category} style={{ marginBottom:18 }}>
                          <CategoryBar label={c.category} score={c.score} max={c.maxPossible} color={CAT_COLORS[c.category]||'#C9900C'} />
                          <div style={{ fontSize:11, color:'#888', marginTop:2 }}>
                            {c.signalsFound} signals · {c.signalsVerified} verified · {c.pct}% of max
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </SectionBoundary>
          )}

          {/* Signals */}
          {tab === 'signals' && (
            <SectionBoundary label="Signals">
              <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, overflow:'hidden' }}>
                {!(score!.signals ?? []).length ? (
                  <div style={{ padding:40, textAlign:'center', color:'#888' }}>No signals recorded yet.</div>
                ) : (
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ background:'#F8F7F4', borderBottom:'1px solid #E8E6E0' }}>
                        {['Signal','Source','Verification','Points awarded'].map(h => (
                          <th key={h} style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(score!.signals ?? []).map((s: any, i: number) => {
                        const vt = VT[s.verificationTier] || VT[4];
                        return (
                          <tr key={i} style={{ borderBottom:'1px solid #F0EDE8' }}>
                            <td style={{ padding:'10px 16px', fontSize:13, fontWeight:500, color:'#0A0A0A' }}>{s.name.replace(/_/g,' ')}</td>
                            <td style={{ padding:'10px 16px', fontSize:11, color:'#888', fontFamily:'monospace' }}>{s.source}</td>
                            <td style={{ padding:'10px 16px' }}>
                              <span style={{ background:vt.bg, color:vt.color, fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:4 }}>{vt.label}</span>
                            </td>
                            <td style={{ padding:'10px 16px', fontSize:13, fontWeight:700, color:'#10B981' }}>
                              +{typeof s.pointsAwarded === 'number' ? s.pointsAwarded.toFixed(1) : s.pointsAwarded}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </SectionBoundary>
          )}

          {/* History table */}
          {tab === 'history' && (
            <SectionBoundary label="History">
              <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, overflow:'hidden' }}>
                {!hist.length ? (
                  <div style={{ padding:40, textAlign:'center', color:'#888' }}>No history yet.</div>
                ) : (
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ background:'#F8F7F4', borderBottom:'1px solid #E8E6E0' }}>
                        {['Date','Score','Tier','Confidence','Change'].map(h => (
                          <th key={h} style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'#888', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...hist].reverse().map((h: any, i: number, arr: any[]) => {
                        const prev = arr[i+1];
                        const d = prev ? h.total_score - prev.total_score : null;
                        return (
                          <tr key={h.snapshot_date} style={{ borderBottom:'1px solid #F0EDE8' }}>
                            <td style={{ padding:'11px 16px', fontSize:13, color:'#555' }}>
                              {new Date(h.snapshot_date).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}
                            </td>
                            <td style={{ padding:'11px 16px', fontSize:15, fontWeight:700 }}>{h.total_score}</td>
                            <td style={{ padding:'11px 16px' }}><TierBadge tier={h.tier} /></td>
                            <td style={{ padding:'11px 16px', fontSize:13, color:'#888' }}>{Math.round(h.confidence_pct)}%</td>
                            <td style={{ padding:'11px 16px', fontSize:13, fontWeight:600, color: d===null?'#888':d>0?'#10B981':d<0?'#EF4444':'#888' }}>
                              {d===null ? '—' : `${d>0?'+':''}${d}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </SectionBoundary>
          )}

          {/* Next actions */}
          {tab === 'actions' && (
            <SectionBoundary label="Next actions">
              {!actions.length ? (
                <div style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:16, padding:40, textAlign:'center' }}>
                  <div style={{ fontSize:36, marginBottom:12 }}>🏆</div>
                  <p style={{ color:'#888', fontSize:14 }}>Your score is well-optimised. No high-impact actions found.</p>
                </div>
              ) : (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px,1fr))', gap:14 }}>
                    {actions.map((a: any) => (
                      <div key={a.id} style={{ background:'#fff', border:'1px solid #E8E6E0', borderRadius:14, padding:20 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                          <h4 style={{ fontSize:14, fontWeight:600, color:'#0A0A0A', margin:0, flex:1, marginRight:10 }}>{a.title}</h4>
                          <span style={{ background:'#EAF3DE', color:'#27500A', fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:99, whiteSpace:'nowrap', flexShrink:0 }}>+{a.estimatedPoints} pts</span>
                        </div>
                        <p style={{ fontSize:13, color:'#888', margin:'0 0 12px', lineHeight:1.6 }}>{a.description}</p>
                        <span style={{
                          fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:4,
                          background: a.difficulty==='easy'?'#EAF3DE':'#FEF3C7',
                          color: a.difficulty==='easy'?'#065F46':'#92400E',
                          textTransform:'capitalize',
                        }}>{a.difficulty}</span>
                      </div>
                    ))}
                  </div>
                  {ad?.totalPotentialPoints > 0 && (
                    <div style={{ marginTop:14, padding:'12px 16px', background:'#EFF6FF', border:'1px solid #B5D4F4', borderRadius:10, fontSize:13, color:'#1E40AF' }}>
                      Complete all actions to potentially gain <strong>+{ad.totalPotentialPoints} points</strong>.
                    </div>
                  )}
                </>
              )}
            </SectionBoundary>
          )}
        </>
      )}
    </Shell>
  );
}
