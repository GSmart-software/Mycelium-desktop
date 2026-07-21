/**
 * Sesión del vault en carpeta (fase 3 del "vault en carpeta", solo-desktop).
 *
 * Distinto del registro de vaults (`lib/vaultMode.ts`, qué carpetas conoce la
 * app) y del `authStore` (identidad interna sembrada): este store guarda el
 * estado de runtime de QUÉ carpeta usa la sesión actual. Abrir un vault:
 *   1. abre/crea su índice SQLite y lo deja como executor activo,
 *   2. siembra la identidad interna (`ensureSeed`) en ese índice,
 *   3. lo indexa releyendo la carpeta,
 *   4. marca el acceso (para el orden por reciente del selector).
 *
 * La ruta abierta se persiste en `sessionStorage` para sobrevivir a las
 * recargas del webview (el arranque y el guard la releen con
 * `rutaVaultPersistida()`). `salir()` vuelve al executor por defecto
 * (`mycelium.db`, modo SQLite clásico) y limpia la ruta.
 */
import { create } from "zustand";
import { abrirIndiceDeVault, setExecutor } from "@/lib/db/client";
import { ensureSeed } from "@/lib/db/auth";
import { crearEsquemaIndice, indexarVault } from "@/lib/db/indexer";
import { setVaultActual } from "@/lib/db/vaultContext";
import { marcarAcceso } from "@/lib/vaultMode";

/** Clave de `sessionStorage` con la ruta del vault abierto (sobrevive recargas). */
const CLAVE_VAULT_ABIERTO = "mycelium:vault-abierto";

type VaultSessionState = {
  /** Carpeta del vault abierto, o `null` en modo SQLite clásico. */
  rutaActual: string | null;
  /** true mientras se abre/indexa un vault. */
  abriendo: boolean;
  /** Detalle del último fallo de `abrir()` (null si no hubo). */
  error: string | null;
  /** Abre un vault (índice + seed + indexado). Devuelve true si quedó listo. */
  abrir: (ruta: string) => Promise<boolean>;
  /** Cierra el vault: vuelve al executor por defecto y limpia el estado. */
  salir: () => Promise<void>;
};

export const useVaultSessionStore = create<VaultSessionState>((set) => ({
  rutaActual: null,
  abriendo: false,
  error: null,

  async abrir(ruta) {
    set({ abriendo: true, error: null });
    try {
      await abrirIndiceDeVault(ruta);
      // El índice recién abierto puede estar vacío: hay que crear el esquema
      // ANTES de sembrar, porque `ensureSeed()` consulta la tabla `usuarios`.
      await crearEsquemaIndice();
      // A partir de aquí los repos escriben también en disco (modo carpeta).
      setVaultActual(ruta);
      await ensureSeed();
      await indexarVault(ruta);
      await marcarAcceso(ruta);
      // Watcher nativo (fase 5): observa la carpeta para reflejar en la UI los
      // cambios hechos desde fuera de la app. No es fatal si falla (el vault
      // sigue usable, solo no se auto-refresca ante cambios externos).
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("iniciar_watcher", { vaultRuta: ruta });
      } catch {
        // sin watcher no hay auto-refresco, pero el vault funciona igual
      }
      try {
        sessionStorage.setItem(CLAVE_VAULT_ABIERTO, ruta);
      } catch {
        // sessionStorage puede no estar disponible: no es fatal, solo no persiste.
      }
      set({ rutaActual: ruta, abriendo: false, error: null });
      return true;
    } catch (error) {
      console.error("[vault] fallo al abrir el vault:", error);
      const message = error instanceof Error ? error.message : "Error desconocido";
      set({ abriendo: false, error: message });
      return false;
    }
  },

  async salir() {
    // Detener el watcher antes de soltar el vault (fase 5). Best-effort.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("detener_watcher");
    } catch {
      // si no había watcher o falla el invoke, no impide salir del vault
    }
    setExecutor(null); // vuelve al executor Tauri por defecto (mycelium.db)
    setVaultActual(null); // los repos vuelven al modo SQLite clásico (sin disco)
    try {
      sessionStorage.removeItem(CLAVE_VAULT_ABIERTO);
    } catch {
      // sin sessionStorage no hay nada que limpiar
    }
    set({ rutaActual: null, error: null });
  },
}));

/** Ruta del vault abierto persistida en `sessionStorage`, o `null` (para el arranque). */
export function rutaVaultPersistida(): string | null {
  try {
    return sessionStorage.getItem(CLAVE_VAULT_ABIERTO);
  } catch {
    return null;
  }
}
