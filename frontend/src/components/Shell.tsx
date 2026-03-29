import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, ROLE_COLORS, TIER_COLORS } from '../store';
import api from '../api/client';
import type { Tier } from '../api/client';

// ════════════════════════════════════════════════════════════
// SHELL LAYOUT
// ════════════════════════════════════════════════════════════

interface NavItem { label: string; path: string; icon: string }

interface ShellProps {
  nav: NavItem[];
  children: React.ReactNode;
  title: string;
}

export function Shell({ nav, children, title }: ShellProps) {
  const { user, clearUser } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const roleColor = user ? ROLE_COLORS[user.role] : '#C9900C';

  async function logout() {
    await api.auth.logout().catch(() => {});
    clearUser();
    navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8F7F4', display: 'flex' }}>

      {/* Sidebar */}
      <aside style={{
        width: 240, background: '#fff', borderRight: '1px solid #E8E6E0',
        display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh',
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #E8E6E0' }}>
          <Link to="/dashboard" style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{ background: '#0A0A0A', borderRadius: 10, padding: '10px 16px', display: 'inline-block' }}>
              <span style={{ color: '#F5C842', fontSize: 18, fontWeight: 700, letterSpacing: '0.04em' }}>IkonetU</span>
            </div>
          </Link>
        </div>

        {/* User pill */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #E8E6E0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: roleColor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {user?.avatarUrl
                ? <img src={user.avatarUrl} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 13, fontWeight: 600, color: roleColor }}>{user?.name?.[0]?.toUpperCase()}</span>
              }
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: roleColor, fontWeight: 500, textTransform: 'capitalize' }}>{user?.role}</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {nav.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} style={{ textDecoration: 'none', display: 'block', marginBottom: 2 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
                  background: active ? roleColor + '12' : 'transparent',
                  color: active ? roleColor : '#555', fontSize: 14, fontWeight: active ? 600 : 400,
                  transition: 'all 0.12s',
                }}>
                  <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Bottom links */}
        <div style={{ padding: '12px 10px', borderTop: '1px solid #E8E6E0' }}>
          <Link to="/settings" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, color: '#888', fontSize: 13 }}>
            <span>⚙️</span> Settings
          </Link>
          <Link to="/billing" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, color: '#888', fontSize: 13 }}>
            <span>💳</span> Billing
          </Link>
          <button onClick={logout} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, color: '#888', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}>
            <span>→</span> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'auto', padding: '32px 36px', maxWidth: 1200 }}>
        {children}
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// SCORE METER — radial arc, 0-1000
// ════════════════════════════════════════════════════════════

export function ScoreMeter({ score, tier, size = 180 }: { score: number; tier: Tier; size?: number }) {
  const color = TIER_COLORS[tier];
  const pct = score / 1000;
  const r = (size / 2) - 14;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = -210;
  const sweepAngle = 240 * pct;

  function polarToCartesian(angle: number) {
    const rad = (angle - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(start: number, sweep: number) {
    const s = polarToCartesian(start);
    const e = polarToCartesian(start + sweep);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const TIER_LABELS: Record<Tier, string> = {
    EARLY: 'Early Stage', RISING: 'Rising', INVESTABLE: 'Investable', ELITE: 'Elite',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <path d={arcPath(-210, 240)} fill="none" stroke="#E8E6E0" strokeWidth={10} strokeLinecap="round" />
        {/* Fill */}
        {score > 0 && (
          <path d={arcPath(-210, sweepAngle)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />
        )}
        {/* Score text */}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#0A0A0A" fontSize={size * 0.18} fontWeight="700" fontFamily="system-ui">
          {score}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill={color} fontSize={size * 0.09} fontWeight="600" fontFamily="system-ui">
          {TIER_LABELS[tier]}
        </text>
        <text x={cx} y={cy + 28} textAnchor="middle" fill="#aaa" fontSize={size * 0.07} fontFamily="system-ui">
          / 1000
        </text>
      </svg>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TIER BADGE
// ════════════════════════════════════════════════════════════

export function TierBadge({ tier }: { tier: Tier }) {
  const LABELS = { EARLY: 'Early Stage', RISING: 'Rising', INVESTABLE: 'Investable', ELITE: 'Elite' };
  const color = TIER_COLORS[tier];
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 99,
      background: color + '18', color, fontSize: 12, fontWeight: 600,
    }}>
      {LABELS[tier]}
    </span>
  );
}

// ════════════════════════════════════════════════════════════
// STAT CARD
// ════════════════════════════════════════════════════════════

export function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8E6E0', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || '#0A0A0A', marginBottom: sub ? 4 : 0 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#888' }}>{sub}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// CATEGORY BAR
// ════════════════════════════════════════════════════════════

export function CategoryBar({ label, score, max, color = '#C9900C' }: { label: string; score: number; max: number; color?: string }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#555', textTransform: 'capitalize' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>{Math.round(score)} <span style={{ color: '#aaa', fontWeight: 400 }}>/ {max}</span></span>
      </div>
      <div style={{ height: 7, background: '#F0EDE8', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: 7, width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// NOTIFICATION BELL
// ════════════════════════════════════════════════════════════

export function NotificationBell({ userId }: { userId: string }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    api.user.notifications(userId, true)
      .then(d => { setCount(d.unreadCount); setNotifications(d.notifications || []); })
      .catch(() => {});
  }, [userId]);

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: '1px solid #E0DED8', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
        🔔
        {count > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 42, width: 320, background: '#fff', border: '1px solid #E0DED8', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.08)', zIndex: 100, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E8E6E0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Notifications</span>
            {count > 0 && (
              <button onClick={() => { api.user.markAllRead(userId); setCount(0); }} style={{ fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {notifications.length === 0
              ? <div style={{ padding: '24px 16px', textAlign: 'center', color: '#888', fontSize: 13 }}>No unread notifications</div>
              : notifications.slice(0, 10).map((n: any) => (
                <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid #F0EDE8', background: n.read ? '#fff' : '#FAFAF7' }}>
                  <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: '#0A0A0A', marginBottom: 3 }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{n.body}</div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}
