import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import api from '../api/client';
import type { Role } from '../api/client';

const ROLES: { id: Role; label: string; icon: string; description: string }[] = [
  { id: 'founder',    label: 'Founder',        icon: '🚀', description: 'Build your score and get investor-ready' },
  { id: 'investor',   label: 'Investor',       icon: '💼', description: 'Discover scored, verified African founders' },
  { id: 'provider',   label: 'Service Provider', icon: '⚡', description: 'Connect with founders who need your services' },
  { id: 'lender',     label: 'Lender',         icon: '🏦', description: 'Access pre-qualified, bankable borrowers' },
  { id: 'university', label: 'University',     icon: '🎓', description: 'Track and support your entrepreneurial alumni' },
];

type Step = 'role' | 'email' | 'otp';

export default function LoginPage() {
  const [step, setStep]       = useState<Step>('role');
  const [role, setRole]       = useState<Role>('founder');
  const [email, setEmail]     = useState('');
  const [name, setName]       = useState('');
  const [code, setCode]       = useState('');
  const [isNew, setIsNew]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [countdown, setCountdown] = useState(0);

  const { setUser } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  function startCountdown() {
    setCountdown(300);
    const t = setInterval(() => {
      setCountdown(c => { if (c <= 1) { clearInterval(t); return 0; } return c - 1; });
    }, 1000);
  }

  async function requestOtp() {
    if (!email.trim()) { setError('Please enter your email address'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.auth.requestOtp(email.trim().toLowerCase(), role, name || undefined);
      setIsNew(res.isNewUser);
      setStep('otp');
      startCountdown();
    } catch (err: any) {
      setError(err.response?.data?.title || 'Failed to send code. Please try again.');
    } finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (code.length !== 6) { setError('Enter the 6-digit code from your email'); return; }
    setLoading(true); setError('');
    try {
      const { user } = await api.auth.verifyOtp(email, code, role);
      setUser(user);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.title || 'Invalid code. Please try again.');
      if (err.response?.data?.code === 'otp-locked') setStep('email');
    } finally { setLoading(false); }
  }

  const fmtCountdown = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  return (
    <div style={{ minHeight: '100vh', background: '#F8F7F4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-block', background: '#0A0A0A', borderRadius: 14, padding: '14px 24px', marginBottom: 16 }}>
            <span style={{ color: '#F5C842', fontSize: 28, fontWeight: 700, letterSpacing: '0.04em' }}>IkonetU</span>
          </div>
          <p style={{ color: '#888', fontSize: 14, margin: 0 }}>African Founder Scoring Platform</p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E0DED8', overflow: 'hidden' }}>

          {/* Step 1: Role selection */}
          {step === 'role' && (
            <div style={{ padding: 32 }}>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0A0A0A', margin: '0 0 8px' }}>Welcome</h1>
              <p style={{ color: '#888', fontSize: 14, margin: '0 0 28px', lineHeight: 1.6 }}>Select your role to get started</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ROLES.map(r => (
                  <button key={r.id} onClick={() => setRole(r.id)} style={{
                    border: `2px solid ${role === r.id ? '#C9900C' : '#E0DED8'}`,
                    borderRadius: 10, padding: '12px 16px', background: role === r.id ? '#FAEEDA' : '#fff',
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <span style={{ fontSize: 24, width: 32, textAlign: 'center' }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A', marginBottom: 2 }}>{r.label}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{r.description}</div>
                    </div>
                    {role === r.id && <span style={{ marginLeft: 'auto', color: '#C9900C', fontSize: 18 }}>✓</span>}
                  </button>
                ))}
              </div>
              <button onClick={() => setStep('email')} style={{
                marginTop: 24, width: '100%', background: '#0A0A0A', color: '#fff',
                border: 'none', borderRadius: 10, padding: '14px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}>
                Continue as {ROLES.find(r => r.id === role)?.label} →
              </button>
            </div>
          )}

          {/* Step 2: Email */}
          {step === 'email' && (
            <div style={{ padding: 32 }}>
              <button onClick={() => setStep('role')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 20 }}>
                ← Back
              </button>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: '#0A0A0A', margin: '0 0 8px' }}>
                Sign in as {ROLES.find(r => r.id === role)?.label}
              </h2>
              <p style={{ color: '#888', fontSize: 14, margin: '0 0 28px' }}>
                We'll send a 6-digit code to your email. No password needed.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Email address
                </label>
                <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && requestOtp()}
                  placeholder="you@company.com"
                  style={{ width: '100%', padding: '12px 14px', border: `1px solid ${error ? '#EF4444' : '#E0DED8'}`, borderRadius: 8, fontSize: 15, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                  autoFocus />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Your name <span style={{ color: '#aaa', fontWeight: 400, textTransform: 'none' }}>(new accounts only)</span>
                </label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && requestOtp()}
                  placeholder="Adenola Adegbesan"
                  style={{ width: '100%', padding: '12px 14px', border: '1px solid #E0DED8', borderRadius: 8, fontSize: 15, outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
              </div>
              {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', color: '#991B1B', fontSize: 13, marginBottom: 16 }}>{error}</div>}
              <button onClick={requestOtp} disabled={loading || !email.trim()} style={{
                width: '100%', background: loading || !email.trim() ? '#ccc' : '#0A0A0A',
                color: '#fff', border: 'none', borderRadius: 10, padding: '14px 20px', fontSize: 15, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
              }}>
                {loading ? 'Sending...' : 'Send verification code'}
              </button>
            </div>
          )}

          {/* Step 3: OTP verify */}
          {step === 'otp' && (
            <div style={{ padding: 32 }}>
              <button onClick={() => { setStep('email'); setCode(''); setError(''); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 20 }}>
                ← Back
              </button>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: '#0A0A0A', margin: '0 0 8px' }}>
                {isNew ? 'Verify your email' : 'Enter your code'}
              </h2>
              <p style={{ color: '#888', fontSize: 14, margin: '0 0 6px' }}>
                We sent a 6-digit code to
              </p>
              <p style={{ color: '#0A0A0A', fontSize: 15, fontWeight: 500, margin: '0 0 28px' }}>{email}</p>

              <div style={{ marginBottom: 24 }}>
                <input type="text" inputMode="numeric" maxLength={6} value={code}
                  onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && code.length === 6 && verifyOtp()}
                  placeholder="000000" autoFocus
                  style={{
                    width: '100%', padding: '16px 14px', border: `2px solid ${error ? '#EF4444' : '#E0DED8'}`,
                    borderRadius: 10, fontSize: 32, fontWeight: 700, textAlign: 'center',
                    letterSpacing: '0.3em', outline: 'none', background: '#F8F7F4', fontFamily: 'monospace', boxSizing: 'border-box',
                  }} />
              </div>

              {countdown > 0 && (
                <p style={{ textAlign: 'center', fontSize: 13, color: '#888', margin: '0 0 16px' }}>
                  Code expires in <span style={{ fontWeight: 600, color: '#C9900C' }}>{fmtCountdown(countdown)}</span>
                </p>
              )}

              {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', color: '#991B1B', fontSize: 13, marginBottom: 16 }}>{error}</div>}

              <button onClick={verifyOtp} disabled={loading || code.length !== 6} style={{
                width: '100%', background: code.length === 6 && !loading ? '#0A0A0A' : '#ccc',
                color: '#fff', border: 'none', borderRadius: 10, padding: '14px 20px', fontSize: 15, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', marginBottom: 16,
              }}>
                {loading ? 'Verifying...' : isNew ? 'Create my account →' : 'Sign in →'}
              </button>

              {countdown === 0 && (
                <button onClick={() => { setCode(''); setError(''); requestOtp(); }} style={{
                  width: '100%', background: 'none', border: '1px solid #E0DED8', borderRadius: 10,
                  padding: '12px 20px', fontSize: 14, color: '#555', cursor: 'pointer',
                }}>
                  Resend code
                </button>
              )}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '16px 32px', borderTop: '1px solid #E8E6E0', background: '#F8F7F4', textAlign: 'center' }}>
            <p style={{ fontSize: 11, color: '#aaa', margin: 0, lineHeight: 1.6 }}>
              IkonetU Technology Limited · England & Wales ·{' '}
              <a href="mailto:customer.service@ikonetu.com" style={{ color: '#aaa' }}>customer.service@ikonetu.com</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
