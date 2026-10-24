"use client";

import { useEffect, useState } from "react";
import styles from "./VentanaAjustes.module.css";

/**
 * Ruta, servida por la propia app, de los avisos de licencia de terceros. La
 * arma `scripts/generar-avisos-terceros.mjs` en cada `dev`/`build`, así que va
 * dentro del binario con el resto del export estático: se lee sin red.
 */
export const RUTA_AVISOS_TERCEROS = "/THIRD-PARTY-NOTICES.txt";

/**
 * «Licencias de terceros», al pie de Configuración: el texto completo de los
 * avisos de licencia de lo que viaja dentro de Mycelium (draw.io, las fuentes
 * de Excalidraw, los paquetes de npm y los crates de Rust). Es texto plano de
 * unos 2,5 MB; se pide recién al abrirlo y se muestra tal cual.
 */
export function LicenciasTerceros() {
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch(RUTA_AVISOS_TERCEROS)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => vigente && setTexto(t))
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, []);

  if (error) {
    return <p className={styles.panelDescripcion}>No se pudieron leer los avisos de licencia.</p>;
  }
  if (texto === null) {
    return <p className={styles.panelDescripcion}>Cargando…</p>;
  }
  return (
    <pre className={styles.licencias} tabIndex={0} aria-label="Avisos de licencia de terceros">
      {texto}
    </pre>
  );
}
