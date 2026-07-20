"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAutoAbrir } from "@/lib/vaultMode";
import { rutaVaultPersistida, useVaultSessionStore } from "@/stores/vaultSessionStore";
import styles from "./page.module.css";

/**
 * Entrada de la app de escritorio (fase 3 del "vault en carpeta"). Decide a
 * dónde ir al arrancar:
 *   1. Si hay una ruta de vault persistida (recarga con vault abierto) → la
 *      reabre y entra al workspace.
 *   2. Si hay un vault de apertura automática (`autoAbrir`) → lo abre y entra.
 *   3. Si no → muestra el selector de vaults (`/vaults`).
 * Si abrir un vault falla, cae al selector para elegir otro.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let cancelado = false;

    async function decidir() {
      const abrir = useVaultSessionStore.getState().abrir;

      const persistida = rutaVaultPersistida();
      if (persistida) {
        const ok = await abrir(persistida);
        if (cancelado) return;
        router.replace(ok ? "/workspace" : "/vaults");
        return;
      }

      const auto = await getAutoAbrir();
      if (cancelado) return;
      if (auto) {
        const ok = await abrir(auto);
        if (cancelado) return;
        router.replace(ok ? "/workspace" : "/vaults");
        return;
      }

      router.replace("/vaults");
    }

    void decidir();
    return () => {
      cancelado = true;
    };
  }, [router]);

  return (
    <main className={styles.main}>
      <div className={styles.brand}>
        <h1 className={styles.title}>Mycelium</h1>
        <p className={styles.tagline}>Abriendo tu espacio de trabajo…</p>
      </div>
    </main>
  );
}
