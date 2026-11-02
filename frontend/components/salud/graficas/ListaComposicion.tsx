"use client";

import type { ComposicionArchivos } from "@/lib/estadisticas";
import { filasComposicion, type Medida } from "@/lib/graficas";
import { usePaletaGraficas } from "@/lib/usePaletaGraficas";
import type { Resaltado } from "./comun";
import styles from "./graficas.module.css";

/**
 * La lista al lado de una gráfica de composición: cada grupo con sus tipos, su
 * valor y su porcentaje. Es la que da nombre a cada color (ningún dato se
 * identifica solo por color). Pasar el puntero o el foco por una fila resalta
 * su grupo en la gráfica, y al revés.
 */
export function ListaComposicion({
  archivos,
  medida,
  resaltado = null,
  onResaltar,
}: { archivos: ComposicionArchivos; medida: Medida } & Resaltado) {
  const paleta = usePaletaGraficas();
  const filas = filasComposicion(archivos, medida);
  return (
    <ul className={styles.lista} aria-label={medida === "bytes" ? "Peso por grupo" : "Archivos por grupo"}>
      {filas.map((f) => (
        <li
          key={f.grupo}
          className={styles.fila}
          data-on={resaltado === f.grupo || undefined}
          data-vacia={f.valor === 0 || undefined}
          tabIndex={0}
          onPointerEnter={() => onResaltar?.(f.grupo)}
          onPointerLeave={() => onResaltar?.(null)}
          onFocus={() => onResaltar?.(f.grupo)}
          onBlur={() => onResaltar?.(null)}
        >
          <i className={styles.muestra} style={{ background: paleta.grupos[f.grupo] }} aria-hidden />
          <span className={styles.filaNombre}>
            {f.nombre}
            <span className={styles.filaDetalle}>{f.detalle}</span>
          </span>
          <span className={styles.filaValor}>{f.texto}</span>
          <span className={styles.filaPorcentaje}>{f.porcentaje}</span>
        </li>
      ))}
    </ul>
  );
}
