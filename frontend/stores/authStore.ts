import { create } from "zustand";
import { api, ApiError } from "@/lib/api";

export type User = {
  id: string;
  email: string;
  nombre: string;
  avatarUrl: string | null;
  tema: string;
  modoOscuro: boolean;
  preferencias?: Record<string, unknown>;
};

export type Vault = {
  id: string;
  nombre: string;
  propietario_id: string;
  rol: "lector" | "editor" | "propietario";
};

type SessionResponse = {
  accessToken: string;
  expiresInMinutes: number;
  user: User;
};

type AuthState = {
  user: User | null;
  vaults: Vault[];
  accessToken: string | null;
  /** true cuando ya se intentó restaurar la sesión (refresh) al cargar */
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nombre: string) => Promise<string>;
  logout: () => Promise<void>;
  /** Restaura la sesión desde la cookie de refresh. Devuelve true si hay sesión. */
  restore: () => Promise<boolean>;
  /** Actualiza el usuario local tras editar perfil/preferencias (HU-34). */
  setUser: (user: User) => void;
};

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Programa el refresh automático un minuto antes de que expire el JWT. */
function scheduleRefresh(minutes: number, restore: () => Promise<boolean>) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void restore(), Math.max(1, minutes - 1) * 60_000);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  vaults: [],
  accessToken: null,
  initialized: false,

  async login(email, password) {
    const session = await api<SessionResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    set({ user: session.user, accessToken: session.accessToken, initialized: true });
    scheduleRefresh(session.expiresInMinutes, get().restore);
    const me = await api<{ user: User; vaults: Vault[] }>("/auth/me", {
      token: session.accessToken,
    });
    set({ vaults: me.vaults });
  },

  async register(email, password, nombre) {
    const result = await api<{ message: string }>("/auth/register", {
      method: "POST",
      body: { email, password, nombre },
    });
    return result.message;
  },

  async logout() {
    if (refreshTimer) clearTimeout(refreshTimer);
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    set({ user: null, vaults: [], accessToken: null });
  },

  async restore() {
    try {
      const session = await api<SessionResponse>("/auth/refresh", { method: "POST" });
      set({ user: session.user, accessToken: session.accessToken, initialized: true });
      scheduleRefresh(session.expiresInMinutes, get().restore);
      const me = await api<{ user: User; vaults: Vault[] }>("/auth/me", {
        token: session.accessToken,
      });
      set({ vaults: me.vaults });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ user: null, accessToken: null, initialized: true });
        return false;
      }
      set({ initialized: true });
      return false;
    }
  },

  setUser(user) {
    set({ user });
  },
}));
