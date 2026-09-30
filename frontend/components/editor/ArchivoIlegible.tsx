"use client";

import { FileWarning, FileCode2, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { nombreDeRuta, tabIdDeArchivo } from "@/lib/otrosArchivos";
import { useTabsStore } from "@/stores/tabsStore";
import styles from "./ArchivoIlegible.module.css";

/**
 * Aviso de un dibujo o diagrama que no se pudo leer (`DEF-119`).
 *
 * Ocupa el lugar del editor a propósito: mientras se ve esto **no hay editor**,
 * así que nada de lo que haga el usuario puede guardarse encima del original.
 *
 * Tres salidas:
 * - **Abrir como texto**: el mismo archivo en el visor de texto (`FUN-L-11`),
 *   que sí deja corregirlo a mano. Es una pestaña `archivo:` como la de
 *   cualquier archivo no indexado; al guardarlo, el watcher avisa y esta vista
 *   se recupera sola.
 * - **Reintentar**: vuelve a leer del disco. Casi nunca hace falta —un arreglo
 *   desde fuera (la IA, otro editor) llega solo por la recarga de `FUN-L-26`—,
 *   pero es la salida obvia si el aviso del watcher se perdió.
 * - Corregirlo desde fuera: lo dice el texto.
 */
export function ArchivoIlegible({
  ruta,
  formato,
  motivo,
  onReintentar,
  compacto = false,
}: {
  /** Ruta relativa del archivo (el id de la nota). */
  ruta: string;
  /** «dibujo de Excalidraw», «diagrama de draw.io». */
  formato: string;
  motivo: string;
  onReintentar: () => void;
  /**
   * Para el modal del embed: sin «Abrir como texto» (la pestaña se abriría detrás
   * del modal) y sin prometer la recarga sola, que el modal no escucha.
   */
  compacto?: boolean;
}) {
  const router = useRouter();
  const abrirComoTexto = () => {
    const tabId = tabIdDeArchivo(ruta);
    useTabsStore.getState().openNote(tabId);
    router.replace(`/workspace?note=${encodeURIComponent(tabId)}`);
  };

  return (
    <div className={styles.aviso} role="alert">
      <FileWarning size={28} aria-hidden className={styles.icono} />
      <p className={styles.titulo}>
        No se pudo leer «{nombreDeRuta(ruta)}»
      </p>
      <p className={styles.detalle}>
        El archivo no es un {formato} válido, así que no se abre el editor: lo que se dibujara
        acá reemplazaría el contenido original. <strong>El archivo en disco no se tocó.</strong>
      </p>
      <p className={styles.motivo}>{motivo}</p>
      <p className={styles.detalle}>
        {compacto
          ? "Corregilo desde fuera de la app (o abriéndolo como texto desde el explorador) y tocá «Reintentar»."
          : "Corregilo como texto o desde fuera de la app: cuando se guarde corregido, esta vista se recarga sola."}
      </p>
      <div className={styles.acciones}>
        {!compacto && (
          <button type="button" className={styles.accion} onClick={abrirComoTexto}>
            <FileCode2 size={14} aria-hidden />
            Abrir como texto
          </button>
        )}
        <button type="button" className={styles.accion} onClick={onReintentar}>
          <RotateCw size={14} aria-hidden />
          Reintentar
        </button>
      </div>
    </div>
  );
}
