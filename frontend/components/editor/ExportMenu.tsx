"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { useMenuEmergente } from "@/lib/useMenuEmergente";
import { useUiStore } from "@/stores/uiStore";
import styles from "./ExportMenu.module.css";

/**
 * Menú "…" de la barra de herramientas del editor: exportar la nota como .md o
 * PDF (A4/Letter), y el interruptor del renderizado de tablas en vivo.
 *
 * **Se llama «Más opciones» y no «Exportar nota»** (`DEF-066`): ya hace más de
 * una cosa —y una de ellas, el renderizado de tablas, ni siquiera es exportar—,
 * así que el nombre viejo describía solo una parte. El `aria-label` ya decía
 * «Más opciones»; el que se había quedado atrás era el `title`, o sea que el
 * texto del tooltip y el que anuncia un lector de pantalla no coincidían.
 *
 * No choca con el «Más acciones» del `⋮` de la barra: ese es el colapso de todo
 * el grupo derecho cuando la pantalla es angosta, y los dos son ramas del mismo
 * ternario — nunca se ven a la vez.
 *
 * El dropdown usa position:fixed para no quedar recortado por contenedores con
 * overflow.
 */
export function ExportMenu({ notaId, titulo }: { notaId: string; titulo: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const liveTables = useUiStore((s) => s.liveTables);
  const setLiveTables = useUiStore((s) => s.setLiveTables);

  const cerrar = useCallback(() => setOpen(false), []);
  // Escape, flechas, foco y un solo menú abierto a la vez: ver useMenuEmergente.
  useMenuEmergente({ abierto: open, cerrar, contenedorRef: wrapRef, menuRef, disparadorRef: btnRef });

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        ref={btnRef}
        type="button"
        className={styles.button}
        aria-label="Más opciones"
        title="Más opciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Más opciones"
          className={styles.menu}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              void exportNoteMd(notaId, titulo);
              setOpen(false);
            }}
          >
            Exportar como .md
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              exportNotePdfActive(notaId, titulo);
              setOpen(false);
            }}
          >
            Exportar como PDF…
          </button>
          <div className={styles.sep} />
          <label className={styles.check}>
            <input
              type="checkbox"
              role="menuitemcheckbox"
              aria-checked={liveTables}
              checked={liveTables}
              onChange={(e) => {
                setLiveTables(e.target.checked);
                refreshAllLiveViews();
              }}
            />
            Renderizar tablas (vista en vivo)
          </label>
        </div>
      )}
    </div>
  );
}
