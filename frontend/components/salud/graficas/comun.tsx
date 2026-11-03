"use client";

import type { GrupoArchivo } from "@/lib/estadisticas";
import styles from "./graficas.module.css";

/**
 * El resaltado sincronizado entre una gráfica de composición y su lista: el
 * grupo bajo el puntero (o con el foco), o `null`. Lo guarda quien monta las
 * dos (la pestaña, el panel).
 */
export type Resaltado = {
  resaltado?: GrupoArchivo | null;
  onResaltar?: (grupo: GrupoArchivo | null) => void;
};

/** Lo que muestra una gráfica sin datos: nunca una gráfica rota. */
export function EstadoVacio({ texto }: { texto: string }) {
  return <p className={styles.vacio}>{texto}</p>;
}
