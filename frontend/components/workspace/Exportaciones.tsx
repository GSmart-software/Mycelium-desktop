"use client";

import { CircleCheck, FolderOpen, LoaderCircle, Printer, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { abrirCarpetaDeExportacion } from "@/lib/exportarConAviso";
import { avisarFallo } from "@/stores/avisosStore";
import { useExportacionesStore, type Exportacion } from "@/stores/exportacionesStore";
import styles from "./Exportaciones.module.css";

/**
 * Cuánto queda a la vista una exportación que terminó (`FUN-M-22`: entre 10 y
 * 15 s). Mientras está en curso no se va: sería perder la única señal de que
 * algo está pasando.
 */
export const DURACION_TERMINADA_MS = 12_000;

/**
 * Las tarjetas de exportación, abajo a la derecha (`FUN-M-22`): «Exportando…»
 * mientras se arma y se escribe el archivo; al terminar, dónde quedó y «Abrir
 * la carpeta»; si falla, por qué. Se cierran solas a los 12 s de terminar, o
 * con la ×. La lógica, en `lib/exportarConAviso.ts`.
 */
/**
 * La esquina de abajo a la derecha: las exportaciones abajo, junto a la barra
 * de estado, y encima los recordatorios (`TarjetasRecordatorio`), que antes
 * ocupaban solos ese lugar. Una sola caja fija para que no se encimen.
 */
export function EsquinaDerecha({ children }: { children: React.ReactNode }) {
  return <div className={styles.esquina}>{children}</div>;
}

export function Exportaciones() {
  const exportaciones = useExportacionesStore((s) => s.exportaciones);
  return (
    <div className={`mic-exportaciones ${styles.pila}`} role="status" aria-live="polite">
      {exportaciones.map((e) => (
        <Tarjeta key={e.id} exportacion={e} />
      ))}
    </div>
  );
}

function Tarjeta({ exportacion: e }: { exportacion: Exportacion }) {
  const cerrar = useExportacionesStore((s) => s.cerrar);
  const terminada = e.estado !== "en-curso";

  // Se va sola recién al terminar; el temporizador arranca en ese momento.
  useEffect(() => {
    if (!terminada) return;
    const t = window.setTimeout(() => cerrar(e.id), DURACION_TERMINADA_MS);
    return () => window.clearTimeout(t);
  }, [terminada, e.id, cerrar]);

  const carpeta = e.ruta ? carpetaDe(e.ruta, e.esCarpeta === true) : null;

  return (
    <div className={`mic-exportacion ${styles.tarjeta}`} data-estado={e.estado}>
      <span className={styles.icono} aria-hidden>
        {e.estado === "en-curso" ? (
          <LoaderCircle size={18} className={styles.girando} />
        ) : e.estado === "lista" ? (
          <CircleCheck size={18} />
        ) : e.estado === "impresion" ? (
          <Printer size={18} />
        ) : (
          <TriangleAlert size={18} />
        )}
      </span>
      <div className={styles.cuerpo}>
        <p className={styles.titulo}>
          {e.estado === "en-curso"
            ? `Exportando ${e.que}…`
            : e.estado === "lista"
              ? `Se exportó ${e.que}`
              : e.estado === "impresion"
                ? `${e.que}: listo para imprimir`
                : `No se pudo exportar ${e.que}`}
        </p>
        {e.estado === "en-curso" && e.progreso && e.progreso.total > 1 && (
          <p className={styles.detalle}>
            {e.progreso.hechos} de {e.progreso.total}
          </p>
        )}
        {e.estado === "lista" && carpeta && (
          <p className={styles.detalle} title={e.ruta ?? undefined}>
            en {carpeta}
          </p>
        )}
        {(e.estado === "fallo" || e.estado === "impresion") && e.detalle && <p className={styles.detalle}>{e.detalle}</p>}
        {e.estado === "lista" && e.ruta && (
          <button
            type="button"
            className={styles.accion}
            onClick={() => void abrirCarpetaDeExportacion(e.ruta!).catch(avisarFallo("abrir la carpeta"))}
          >
            <FolderOpen size={14} aria-hidden />
            Abrir la carpeta
          </button>
        )}
      </div>
      {terminada && (
        <button type="button" className={styles.cerrar} aria-label="Cerrar el aviso de exportación" onClick={() => cerrar(e.id)}>
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Dónde quedó, para leer: la carpeta que contiene el archivo (sus dos últimos
 * tramos, que alcanzan para reconocerla), o la carpeta misma si se exportó a
 * una carpeta. La ruta entera va en el `title`.
 */
function carpetaDe(ruta: string, esCarpeta: boolean): string {
  const sep = ruta.includes("\\") ? "\\" : "/";
  const partes = ruta.replace(/[\\/]+$/, "").split(/[\\/]/);
  const dir = esCarpeta ? partes : partes.slice(0, -1);
  return dir.length <= 2 ? dir.join(sep) || sep : `…${sep}${dir.slice(-2).join(sep)}`;
}
