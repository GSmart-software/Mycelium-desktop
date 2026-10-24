"use client";

import { useState } from "react";
import { avisar } from "@/stores/avisosStore";
import { useConfigLocalStore } from "@/stores/configLocalStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { AVISO_CONSOLA } from "@/components/workspace/DevToolsHotkey";
import { Interruptor } from "./Interruptor";
import styles from "./Settings.module.css";

/**
 * Sección Avanzado: las herramientas de desarrollo.
 *
 * Por vault y **apagadas por defecto en cada uno**. La decisión se guarda en la
 * configuración local de esta máquina, no en `.mycelium/`: si viajara con el
 * vault, uno ajeno llegaría con la consola a un F12 de distancia
 * (`src-tauri/src/devtools.rs`).
 */
export function AvanzadoSection() {
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const devtools = useConfigLocalStore((s) => s.config.devtools);
  const fijar = useConfigLocalStore((s) => s.fijar);
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onToggle = async (valor: boolean) => {
    setError(null);
    setCambiando(true);
    try {
      await fijar({ clave: "devtools", valor });
      if (valor) avisar(AVISO_CONSOLA);
    } catch (e) {
      setError(`No se pudo guardar: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setCambiando(false);
    }
  };

  if (!rutaVault) {
    return <p className={styles.hint}>Disponible con un vault abierto: se enciende para cada vault.</p>;
  }

  return (
    <div>
      <Interruptor
        etiqueta="Herramientas de desarrollo"
        valor={devtools}
        disabled={cambiando}
        onChange={(v) => void onToggle(v)}
        ayuda={
          <>
            Abre la consola del navegador con <strong>F12</strong> o <strong>Ctrl+Shift+I</strong>, útil
            para escribir CSS propio.
          </>
        }
        detalle="Se enciende en esta computadora y solo para este vault: en los demás siguen apagadas, y no viaja con la carpeta. Apagarlas no cierra una consola que ya esté abierta."
      />
      {devtools && (
        <p className={styles.warn} role="alert">
          ⚠ {AVISO_CONSOLA}
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
