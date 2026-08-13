"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ETAPAS,
  ETIQUETA_ETAPA,
  useVaultSessionStore,
  type EtapaApertura,
} from "@/stores/vaultSessionStore";
import styles from "./AperturaVault.module.css";

/** Segundos sin ningún avance tras los que se avisa de que puede estar atascado. */
const SEGUNDOS_ATASCO = 15;

/**
 * Pantalla de carga de la apertura de un vault (`DEF-042`).
 *
 * Sustituye a dos cosas que estaban mal: el progreso del indexado escribiéndose
 * **en todos** los botones de la lista de vaults —incluidos los que no se
 * abrieron— y el «Cargando…» mudo del arranque automático.
 *
 * > [!note] Deliberadamente desacoplada de quién produce el progreso
 * > Solo lee `vaultSessionStore`. Hoy lo alimenta el `onProgress` de
 * > `indexarVault`; cuando `FUN-L-10` mueva el indexado a Rust y lo emita por
 * > eventos, bastará con que alimente el mismo store y esta pantalla no se toca.
 * > Era el motivo por el que el backlog emparentaba este defecto con aquella
 * > funcionalidad.
 */
export function AperturaVault() {
  const etapa = useVaultSessionStore((s) => s.etapa);
  const progreso = useVaultSessionStore((s) => s.progreso);
  const ruta = useVaultSessionStore((s) => s.rutaAbriendo);
  const avanceEn = useVaultSessionStore((s) => s.avanceEn);

  // Un tic por segundo, solo para poder decir cuánto lleva parado. No se puede
  // deducir del store: mientras nada avanza, nada lo re-renderiza.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const parado = avanceEn > 0 ? Math.floor((ahora - avanceEn) / 1000) : 0;
  const atascado = parado >= SEGUNDOS_ATASCO;
  const indice = etapa === null ? -1 : ETAPAS.indexOf(etapa);

  const porcentaje =
    progreso !== null && progreso.total > 0
      ? Math.min(100, Math.round((progreso.hechas / progreso.total) * 100))
      : null;

  return (
    <main className={styles.main}>
      <section className={styles.panel} role="status" aria-live="polite">
        <h1 className={styles.titulo}>Abriendo el vault</h1>
        {ruta !== null && (
          <p className={styles.ruta} title={ruta}>
            {ruta}
          </p>
        )}

        <ol className={styles.etapas}>
          {ETAPAS.map((e, i) => (
            <li
              key={e}
              className={
                i < indice ? styles.hecha : i === indice ? styles.actual : styles.pendiente
              }
            >
              <span className={styles.marca} aria-hidden>
                {i < indice ? (
                  <Check size={13} />
                ) : i === indice ? (
                  <Loader2 size={13} className={styles.gira} />
                ) : (
                  <span className={styles.punto} />
                )}
              </span>
              <span>{ETIQUETA_ETAPA[e]}</span>
              {i === indice && <Detalle etapa={e} progreso={progreso} />}
            </li>
          ))}
        </ol>

        {porcentaje !== null && (
          <div
            className={styles.barra}
            role="progressbar"
            aria-valuenow={porcentaje}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={styles.barraRelleno} style={{ width: `${porcentaje}%` }} />
          </div>
        )}

        {atascado && (
          <p className={styles.atasco}>
            <AlertTriangle size={14} aria-hidden />
            <span>
              Lleva <strong>{parado} s</strong> sin avanzar
              {etapa !== null && <> en «{ETIQUETA_ETAPA[etapa].toLowerCase()}»</>}. Puede
              seguir trabajando —un vault con muchos archivos tarda— pero si no se mueve,
              algo se atascó.
            </span>
          </p>
        )}
      </section>
    </main>
  );
}

/** Contador de archivos, solo mientras se indexa. */
function Detalle({
  etapa,
  progreso,
}: {
  etapa: EtapaApertura;
  progreso: { hechas: number; total: number } | null;
}) {
  if (etapa !== "indexando" || progreso === null || progreso.total === 0) return null;
  return (
    <span className={styles.detalle}>
      {progreso.hechas} de {progreso.total} archivos
    </span>
  );
}
