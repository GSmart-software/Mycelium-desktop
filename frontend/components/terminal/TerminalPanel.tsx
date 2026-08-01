"use client";

import { ChevronDown, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
 * (cerrar la pestaña NO termina el shell) y permite crear nuevas — con la shell
 * por defecto o eligiendo el tipo —, renombrarlas o FINALIZARLAS (matar el
 * proceso y quitarlas de la lista). Se abre desde el rail.
 */
export function TerminalPanel() {
  const router = useRouter();
  const sesiones = useTerminalStore((s) => s.sesiones);
  const renombrar = useTerminalStore((s) => s.renombrar);
  const root = useTabsStore((s) => s.root);
  const dockTabs = useSidebarViewerStore((s) => s.tabs);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renombrando, setRenombrando] = useState<{ id: string; valor: string } | null>(null);
  const elegirRef = useRef<HTMLButtonElement>(null);

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
    router.replace(`/workspace?note=${encodeURIComponent(tabId)}`);
  };

  const abrir = (termId: string) => {
    abrirConsola(termId);
    router.replace(`/workspace?note=${encodeURIComponent(tabIdDe(termId))}`);
  };

  /** Menú de shells en la posición dada (botón "elegir shell" o clic derecho). */
  const menuShells = (x: number, y: number) => {
    if (shells.length === 0) return;
    setMenu({
      x,
      y,
      items: shells.map((s) => ({ label: s.nombre, onClick: () => nueva(s.id) })),
    });
  };

  const confirmarRename = () => {
    if (renombrando) renombrar(renombrando.id, renombrando.valor);
    setRenombrando(null);
  };

  const ids = Object.keys(sesiones);

  return (
    <div className={styles.panel}>
      <div className={styles.acciones}>
        <button
          type="button"
          className={styles.nueva}
          onClick={() => nueva()}
          onContextMenu={(e) => {
            e.preventDefault();
            menuShells(e.clientX, e.clientY);
          }}
          title="Nueva terminal con la shell por defecto"
        >
          <Plus size={15} aria-hidden /> Nueva terminal
        </button>
        <button
          ref={elegirRef}
          type="button"
          className={styles.elegir}
          aria-label="Nueva terminal eligiendo la shell"
          title="Elegir el tipo de shell"
          onClick={() => {
            const r = elegirRef.current?.getBoundingClientRect();
            if (r) menuShells(r.left, r.bottom + 4);
          }}
        >
          <ChevronDown size={15} aria-hidden />
        </button>
      </div>

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
            const enRename = renombrando?.id === termId;
            return (
              <li key={termId}>
                <div
                  className={`${styles.fila} ${abierta ? styles.filaAbierta : ""}`}
                  role="button"
                  tabIndex={0}
                  title={abierta ? "Ir a la pestaña" : "Reabrir la consola"}
                  onClick={() => !enRename && abrir(termId)}
                  onKeyDown={(e) => e.key === "Enter" && !enRename && abrir(termId)}
                >
                  <span
                    className={`${styles.dot} ${corriendo ? styles.dotOn : ""}`}
                    title={corriendo ? "En ejecución" : "Detenida (se recrea al abrirla)"}
                    aria-hidden
                  />
                  <span className={styles.info}>
                    {enRename ? (
                      <input
                        className={styles.renameInput}
                        value={renombrando.valor}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setRenombrando({ id: termId, valor: e.target.value })
                        }
                        onBlur={confirmarRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmarRename();
                          if (e.key === "Escape") setRenombrando(null);
                        }}
                      />
                    ) : (
                      <span className={styles.titulo}>{sesion.titulo}</span>
                    )}
                    <span className={styles.shell}>{nombreShell(sesion.shellId)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.accionFila}
                    aria-label={`Renombrar ${sesion.titulo}`}
                    title="Renombrar"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenombrando({ id: termId, valor: sesion.titulo });
                    }}
                  >
                    <Pencil size={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`${styles.accionFila} ${styles.finalizar}`}
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
