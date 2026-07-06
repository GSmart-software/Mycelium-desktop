"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

/**
 * Entrada de la app de escritorio: no hay landing ni login (auth latente). Se
 * redirige directo al workspace; el `WorkspaceGuard` restaura la sesión sembrada.
 * (En un futuro build web con cuentas reales, aquí volvería la landing tras el seam.)
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/workspace");
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
