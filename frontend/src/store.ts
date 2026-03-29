// ════════════════════════════════════════════════════════════
// IKONETU FRONTEND — Main App
// Light mode only. Always. No dark mode. No exceptions.
// All design decisions flow from ikonetu-vvip-v8.jsx
// ════════════════════════════════════════════════════════════

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Role } from './api/client';

// ── Auth store ───────────────────────────────────────────────
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User) => void;
  clearUser: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      setUser: (user) => set({ user, isAuthenticated: true }),
      clearUser: () => set({ user: null, isAuthenticated: false }),
      setLoading: (isLoading) => set({ isLoading }),
    }),
    { name: 'iku-auth', partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }) }
  )
);

// ── Role colours (from ikonetu-vvip-v8.jsx) ──────────────────
export const ROLE_COLORS: Record<Role, string> = {
  founder:     '#C9900C',
  investor:    '#1D4ED8',
  provider:    '#059669',
  lender:      '#7C3AED',
  university:  '#DC2626',
  super_admin: '#0A0A0A',
};

export const TIER_COLORS = {
  EARLY:      '#94A3B8',
  RISING:     '#F59E0B',
  INVESTABLE: '#10B981',
  ELITE:      '#C9900C',
};
