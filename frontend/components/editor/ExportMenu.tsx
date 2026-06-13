"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import styles from "./ExportMenu.module.css";

/**
 * Menú "…" de exportación para la barra de herramientas del editor: exportar
 * la nota como .md o PDF (A4/Letter). El dropdown usa position:fixed para no
 * quedar recortado por contenedores con overflow.
 */
export function ExportMenu({ notaId, titulo }: { notaId: string; titulo: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

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
        title="Exportar nota"
        onClick={toggle}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div className={styles.menu} style={{ position: "fixed", top: pos.top, right: pos.right }}>
          <button
            type="button"
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
            className={styles.item}
            onClick={() => {
              void exportNotePdfActive(notaId, titulo, "A4");
              setOpen(false);
            }}
          >
            Exportar como PDF (A4)
          </button>
          <button
            type="button"
            className={styles.item}
            onClick={() => {
              void exportNotePdfActive(notaId, titulo, "Letter");
              setOpen(false);
            }}
          >
            Exportar como PDF (Letter)
          </button>
        </div>
      )}
    </div>
  );
}
