/**
 * Sesión del vault local (desktop). No hay usuarios ni login: al arrancar,
 * `restore()` abre la base SQLite local (sembrando la identidad interna y el
 * vault por defecto si hace falta) y deja en memoria `user` y `vaults`.
 * El `accessToken` es un marcador ("local"): muchos módulos lo leen para
 * pasarlo a `api()`, que lo ignora. La sesión local no expira.
 */
import { create } from "zustand";
import { api } from "@/lib/api";

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
  /** true cuando ya se intentó abrir la sesión local al cargar */
  initialized: boolean;
  /** Detalle del último fallo de `restore()` (null si no hubo). */
  error: string | null;
  /** Abre la sesión del vault local. Devuelve true si quedó lista. */
  restore: () => Promise<boolean>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  vaults: [],
  accessToken: null,
  initialized: false,
  error: null,

  async restore() {
    try {
      const session = await api<SessionResponse>("/auth/refresh", { method: "POST" });
      set({
        user: session.user,
        accessToken: session.accessToken,
        initialized: true,
        error: null,
      });
      const me = await api<{ user: User; vaults: Vault[] }>("/auth/me", {
        token: session.accessToken,
      });
      set({ vaults: me.vaults });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      set({ user: null, accessToken: null, initialized: true, error: message });
      return false;
    }
  },
}));
