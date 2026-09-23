'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  setToken: (t: string | null) => void;
  salir: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      salir: () => set({ token: null }),
    }),
    { name: 'crm-auth' },
  ),
);
