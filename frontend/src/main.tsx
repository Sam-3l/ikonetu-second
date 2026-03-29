import React, { useEffect, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useAuthStore } from './store';
import { ErrorBoundary } from './components/ErrorBoundary';
import api, { tokenStore } from './api/client';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

// ── Lazy pages ───────────────────────────────────────────────
const LoginPage        = React.lazy(() => import('./pages/LoginPage'));
const OnboardingPage   = React.lazy(() => import('./pages/OnboardingPage'));
const FounderDashboard = React.lazy(() => import('./pages/FounderDashboard'));
const InvestorDashboard= React.lazy(() => import('./pages/InvestorDashboard'));
const ProviderDashboard= React.lazy(() => import('./pages/ProviderDashboard'));
const LenderDashboard  = React.lazy(() => import('./pages/LenderDashboard'));
const UniversityDashboard = React.lazy(() => import('./pages/UniversityDashboard'));
const GoldenEye        = React.lazy(() => import('./pages/GoldenEye'));
const ScoreDetailPage  = React.lazy(() => import('./pages/ScoreDetailPage'));
const SettingsPage     = React.lazy(() => import('./pages/SettingsPage'));
const BillingPage      = React.lazy(() => import('./pages/BillingPage'));

// ── Route guard ──────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user && !user.onboardingCompleted && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function RoleDashboard() {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const map: Record<string, React.ReactNode> = {
    founder:     <FounderDashboard />,
    investor:    <InvestorDashboard />,
    provider:    <ProviderDashboard />,
    lender:      <LenderDashboard />,
    university:  <UniversityDashboard />,
    super_admin: <GoldenEye />,
  };
  return <>{map[user.role] ?? <Navigate to="/login" replace />}</>;
}

// ── Session restore on page load ─────────────────────────────
function SessionRestore({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, clearUser } = useAuthStore();
  const refreshToken = tokenStore.getRefresh();

  useEffect(() => {
    if (!refreshToken) return;
    setLoading(true);
    api.auth.me()
      .then(({ user }) => setUser(user))
      .catch(() => clearUser())
      .finally(() => setLoading(false));
  }, []);

  return <>{children}</>;
}

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8F7F4' }}>
      <div style={{ width: 32, height: 32, border: '3px solid #E0DED8', borderTopColor: '#C9900C', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SessionRestore>
          <ErrorBoundary context='App'>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
              <Route path="/dashboard" element={<RequireAuth><RoleDashboard /></RequireAuth>} />
              <Route path="/score/:ventureId" element={<RequireAuth><ScoreDetailPage /></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
              <Route path="/billing" element={<RequireAuth><BillingPage /></RequireAuth>} />
              <Route path="/admin/*" element={<RequireAuth><GoldenEye /></RequireAuth>} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </SessionRestore>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
export default App;
