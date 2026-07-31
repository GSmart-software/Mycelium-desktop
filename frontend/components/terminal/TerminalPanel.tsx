"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "@/components/explorer/ContextMenu";
import {
  abrirConsola,
  crearTerminal,
  esTabTerminal,
  estaCorriendo,
  finalizarConsola,
  listarShells,
  tabIdDe,
  termIdDe,
  type ShellInfo,
} from "@/lib/terminal";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import styles from "./TerminalPanel.module.css";

/**
 * Panel de consolas (FUN-L-07): lista las consolas iniciadas para reabrirlas
 * (cerrar la pestaña NO termina el shell) y permite crear nuevas o FINALIZARLAS
 * (matar el proceso y quitarlas de la lista). Se abre desde el rail.
 */
export function TerminalPanel() {
  const router = useRouter();
  const sesiones = useTerminalStore((s) => s.sesiones);
  const root = useTabsStore((s) => s.root);
  const dockTabs = useSidebarViewerStore((s) => s.tabs);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  useEffect(() => {
    void listarShells().then(setShells);
  }, []);

  // Consolas con pestaña visible (workspace o visor del explorador).
  const conPestana = new Set<string>();
  for (const leaf of allLeaves(root)) {
    for (const tab of leaf.tabs) {
      if (esTabTerminal(tab.notaId)) conPestana.add(termIdDe(tab.notaId));
    }
  }
  for (const tabId of dockTabs) {
    if (esTabTerminal(tabId)) conPestana.add(termIdDe(tabId));
  }

  const nombreShell = (shellId: string | null) =>
    shells.find((s) => s.id === shellId)?.nombre ?? "Shell por defecto";

  const nueva = (shellId?: string) => {
    const tabId = crearTerminal(shellId ? { shellId } : {});
    router.push(`/workspace?note=${encodeURIComponent(tabId)}`);
  };

  const abrir = (termId: string) => {
    abrirConsola(termId);
    router.push(`/workspace?note=${encodeURIComponent(tabIdDe(termId))}`);
  };

  const elegirShell = (e: React.MouseEvent) => {
    e.preventDefault();
    const { clientX: x, clientY: y } = e;
    if (shells.length === 0) return;
    setMenu({
      x,
      y,
      items: shells.map((s) => ({ label: s.nombre, onClick: () => nueva(s.id) })),
    });
  };

  const ids = Object.keys(sesiones);

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.nueva}
        onClick={() => nueva()}
        onContextMenu={elegirShell}
        title="Nueva terminal (clic derecho: elegir shell)"
      >
        <Plus size={15} aria-hidden /> Nueva terminal
      </button>

      {ids.length === 0 ? (
        <p className={styles.vacio}>
          No hay consolas iniciadas. Creá una con el botón de arriba; cerrar su
          pestaña no la termina — podés reabrirla desde aquí.
        </p>
      ) : (
        <ul className={styles.lista}>
          {ids.map((termId) => {
            const sesion = sesiones[termId];
            const corriendo = estaCorriendo(termId);
            const abierta = conPestana.has(termId);
            return (
              <li key={termId}>
                <div
                  className={`${styles.fila} ${abierta ? styles.filaAbierta : ""}`}
                  role="button"
                  tabIndex={0}
                  title={abierta ? "Ir a la pestaña" : "Reabrir la consola"}
                  onClick={() => abrir(termId)}
                  onKeyDown={(e) => e.key === "Enter" && abrir(termId)}
                >
                  <span
                    className={`${styles.dot} ${corriendo ? styles.dotOn : ""}`}
                    title={corriendo ? "En ejecución" : "Detenida (se recrea al abrirla)"}
                    aria-hidden
                  />
                  <span className={styles.info}>
                    <span className={styles.titulo}>{sesion.titulo}</span>
                    <span className={styles.shell}>{nombreShell(sesion.shellId)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.finalizar}
                    aria-label={`Finalizar ${sesion.titulo}`}
                    title="Finalizar (termina el proceso y la quita de la lista)"
                    onClick={(e) => {
                      e.stopPropagation();
                      finalizarConsola(termId);
                    }}
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
