/**
 * Identidad del desktop: **constantes**, no una sesión.
 *
 * En desktop no hay usuarios ni login (`desktop-sin-login`), y desde `FUN-L-24`
 * (2026-09-26) tampoco una identidad interna sembrada en SQLite: cada vault tiene
 * su propio índice y dentro de él el vault es siempre `LOCAL_VAULT_ID`. Este
 * store existe solo para que los componentes compartidos con web —que leen
 * `vaults[0].id` y pasan `accessToken` a `api()`— sigan siendo el mismo archivo
 * en las dos ramas. Por eso conserva la forma del de web, con valores fijos:
 *
 *   - `user` fijo, `vaults` = el vault del índice abierto, `accessToken` =
 *     `"local"` (`api()` lo ignora), `initialized` = true desde el arranque;
 *   - `restore()` no hace nada: no hay nada que restaurar.
 *
 * Lo que decide si hay un vault abierto es `vaultSessionStore`, no este store.
 */
import { create } from "zustand";
import { LOCAL_VAULT_ID } from "@/lib/db/vaultContext";

export type User = {
  id: string;
  email: string;
  nombre: string;
  avatarUrl: string | null;
};

export type Vault = {
  id: string;
  nombre: string;
  propietario_id: string;
  rol: "lector" | "editor" | "propietario";
};

const USUARIO_LOCAL: User = {
  id: "local-user",
  email: "local@mycelium.app",
  nombre: "Yo",
  avatarUrl: null,
};

const VAULT_LOCAL: Vault = {
  id: LOCAL_VAULT_ID,
  nombre: "Mi Vault",
  propietario_id: USUARIO_LOCAL.id,
  rol: "propietario",
};

type AuthState = {
  user: User;
  vaults: Vault[];
  accessToken: string;
  /** Siempre true: no hay nada que esperar. */
  initialized: boolean;
  /** Siempre null: una constante no falla. */
  error: string | null;
  /** Sin efecto; se conserva por la forma compartida con web. */
  restore: () => Promise<boolean>;
};

export const useAuthStore = create<AuthState>(() => ({
  user: USUARIO_LOCAL,
  vaults: [VAULT_LOCAL],
  accessToken: "local",
  initialized: true,
  error: null,
  restore: async () => true,
}));
