"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import {
  abrirPty,
  fueTocadaEstaCorrida,
  getInstancia,
  ocultarPestanas,
} from "@/lib/terminal";
import { useTerminalStore } from "@/stores/terminalStore";
import styles from "./TerminalView.module.css";

/**
 * Vista de una terminal integrada (FUN-L-07). El estado real (xterm + PTY) vive
 * en `lib/terminal.ts` a nivel de módulo: este componente solo adjunta el DOM de
 * su instancia y lo ajusta al tamaño del pane. Así, mover la pestaña de panel
 * (remount) NO reinicia la sesión (CA2).
 */
export function TerminalView({ termId }: { termId: string }) {
  const contRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cont = contRef.current;
    if (!cont) return;

    // Restauración desactivada: una pestaña de la sesión anterior no se reabre
    // al arrancar — se OCULTA (la consola sigue listada en el panel y puede
    // abrirse desde allí, que la marca como tocada) (CA6).
    const { prefs } = useTerminalStore.getState();
    if (!fueTocadaEstaCorrida(termId) && !prefs.restaurarSesiones) {
      ocultarPestanas(termId);
      return;
    }

    const inst = getInstancia(termId);
    // Primera vez: montar el xterm; remounts: re-adjuntar su elemento.
    if (inst.term.element) {
      cont.appendChild(inst.term.element);
    } else {
      inst.term.open(cont);
    }

    // Ajuste al tamaño del pane; sincroniza el PTY cuando cambian cols/rows.
    let cols = inst.term.cols;
    let rows = inst.term.rows;
    const ajustar = () => {
      if (!cont.clientWidth || !cont.clientHeight) return;
      inst.fit.fit();
      if (inst.term.cols !== cols || inst.term.rows !== rows) {
        cols = inst.term.cols;
        rows = inst.term.rows;
        void invoke("terminal_redimensionar", { id: termId, cols, rows }).catch(() => {});
      }
    };
    const observer = new ResizeObserver(ajustar);
    observer.observe(cont);
    ajustar();

    void abrirPty(termId).then(() => ajustar());
    inst.term.focus();

    return () => observer.disconnect();
  }, [termId]);

  return <div ref={contRef} className={styles.terminal} />;
}
