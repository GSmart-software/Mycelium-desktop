"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Table2,
  Folder,
  FolderPlus,
  Shapes,
  Upload,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revelarEnSistema } from "@/lib/db/vaultFs";
import { api } from "@/lib/api";
import { baseInicial } from "@/lib/bases";
import { carpetaEsporas, crearNotaDesdeEspora, listarEsporas } from "@/lib/esporasVault";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { crearTerminal } from "@/lib/terminal";
import { collectFromDataTransfer, collectFromFileList } from "@/lib/import";
import { useAuthStore } from "@/stores/authStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useImportStore } from "@/stores/importStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { SharedSection } from "./SharedSection";
import {
  useVaultStore,
  type NotaTipo,
  type TreeCarpeta,
  type TreeNota,
} from "@/stores/vaultStore";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import styles from "./ExplorerPanel.module.css";
import { confirmar } from "@/lib/confirmar";

/**
 * DEF-023 P2: pane y zona (borde = dividir / centro = abrir) bajo un punto de
 * pantalla, por geometría de los cuerpos de pane (`[data-pane-id]`). Se usa el
 * punto REAL del puntero (no `elementFromPoint`, que en el WebView de Tauri
 * devuelve el ghost). `null` si el punto no cae en ningún pane.
 */
function paneObjetivoEnPunto(
  x: number,
  y: number,
): { paneId: string; edge: "top" | "bottom" | "left" | "right" | "center" } | null {
  const UMBRAL = 56; // px desde el borde para dividir; más adentro = centro
  for (const el of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const d = { top: y - r.top, bottom: r.bottom - y, left: x - r.left, right: r.right - x };
    const min = Math.min(d.top, d.bottom, d.left, d.right);
    const edge =
      min > UMBRAL
        ? "center"
        : min === d.top
          ? "top"
          : min === d.bottom
            ? "bottom"
            : min === d.left
              ? "left"
              : "right";
    return { paneId: el.dataset.paneId!, edge };
  }
  return null;
}

/**
 * Colisión para el arrastre interno: como la zona de cada carpeta cubre también
 * su contenido, varias zonas anidadas (y la raíz) se solapan bajo el puntero.
 * Gana la MÁS PEQUEÑA, que es la carpeta más profunda; la raíz (la mayor) solo
 * si el puntero no está dentro de ninguna carpeta. Así, soltar en el hueco de
 * una carpeta deja el archivo DENTRO de ella y no en la raíz.
 *
 * DEF-023 P2: si el PUNTERO está sobre un pane del área de trabajo, no colisiona
 * con ninguna carpeta (devuelve []), para que soltar ahí solo abra/divida y NO
 * mueva el archivo en el explorador (la decisión sigue al puntero, no al ghost).
 */
const dropMasProfundo: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  if (p && paneObjetivoEnPunto(p.x, p.y)) return [];
  const dentro = pointerWithin(args);
  if (dentro.length === 0) return rectIntersection(args);
  const area = (id: string | number) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  return [...dentro].sort((a, b) => area(a.id) - area(b.id));
};

type MenuState = { x: number; y: number; items: MenuItem[] } | null;
type RenameState = { type: "carpeta" | "nota"; id: string; valor: string } | null;

/**
 * Explorer del vault (HU-22/23/24): árbol de carpetas anidadas y notas,
 * menú contextual, rename inline, drag & drop y deshacer con Ctrl+Z.
 */
export function ExplorerPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeNoteId = searchParams.get("note");

  const vaults = useAuthStore((s) => s.vaults);
  // Ruta del vault en carpeta abierto (null en modo SQLite clásico): habilita
  // "Mostrar en el explorador", que solo tiene sentido con archivos en disco.
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const store = useVaultStore();
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<RenameState>(null);
  // Destino de un arrastre de archivos DESDE el SO (DEF-036/036b): id de la
  // carpeta bajo el cursor, `null` = raíz, `undefined` = no hay arrastre.
  const [osDropTarget, setOsDropTarget] = useState<string | null | undefined>(undefined);
  const [archivosCollapsed, setArchivosCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("mic-sec-archivos") === "1",
  );
  const toggleArchivos = () =>
    setArchivosCollapsed((v) => {
      const next = !v;
      localStorage.setItem("mic-sec-archivos", next ? "1" : "0");
      return next;
    });
  // Colapso de "Compartido" elevado aquí para coordinar la división redimensionable
  // (DEF-023). Misma clave localStorage que antes usaba SharedSection.
  const [compartidosCollapsed, setCompartidosCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("mic-sec-compartido") === "1",
  );
  const toggleCompartidos = () =>
    setCompartidosCollapsed((v) => {
      const next = !v;
      localStorage.setItem("mic-sec-compartido", next ? "1" : "0");
      return next;
    });
  // Alto (px) del panel "Compartido" cuando está expandido; ajustable con el
  // divisor y persistido. Archivos ocupa el resto. (DEF-023)
  const [compartidosPx, setCompartidosPx] = useState(() => {
    if (typeof window === "undefined") return 200;
    const v = Number(localStorage.getItem("mic-split-compartido"));
    return Number.isFinite(v) && v > 0 ? v : 200;
  });
  const explorerRef = useRef<HTMLDivElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<string | null>(null);

  const vaultId = vaults[0]?.id;

  useEffect(() => {
    if (vaultId) void store.loadTree(vaultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId]);

  // Ctrl+Z deshace el último movimiento (HU-24 CA7)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key === "z" && store.lastMove) {
        event.preventDefault();
        void store.undoLastMove();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.lastMove]);

  const carpetasPorPadre = useMemo(() => {
    const map = new Map<string | null, TreeCarpeta[]>();
    for (const carpeta of store.carpetas) {
      const list = map.get(carpeta.padreId) ?? [];
      list.push(carpeta);
      map.set(carpeta.padreId, list);
    }
    return map;
  }, [store.carpetas]);

  const notasPorCarpeta = useMemo(() => {
    const map = new Map<string | null, TreeNota[]>();
    for (const nota of store.notas) {
      const list = map.get(nota.carpetaId) ?? [];
      list.push(nota);
      map.set(nota.carpetaId, list);
    }
    return map;
  }, [store.notas]);

  // Carpeta compartida si ella o algún ancestro tiene membresías (HU-35 CA5)
  const sharedSet = useMemo(() => new Set(store.sharedCarpetaIds), [store.sharedCarpetaIds]);
  const carpetasById = useMemo(
    () => new Map(store.carpetas.map((c) => [c.id, c])),
    [store.carpetas],
  );
  const isCarpetaShared = useCallback(
    (id: string | null): boolean => {
      let current = id;
      while (current) {
        if (sharedSet.has(current)) return true;
        current = carpetasById.get(current)?.padreId ?? null;
      }
      return false;
    },
    [sharedSet, carpetasById],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const openNota = useCallback(
    (id: string) => {
      // Abrir en el pane activo aunque la URL ya apunte a esta nota
      useTabsStore.getState().openNote(id);
      router.replace(`/workspace?note=${id}`);
    },
    [router],
  );

  // Clic con la rueda: abre la nota en segundo plano (sin robar el foco).
  const openNotaBackground = useCallback(
    (id: string) => {
      useTabsStore.getState().openNoteBackground(id);
      const nid = useTabsStore.getState().activeNotaId();
      router.replace(nid ? `/workspace?note=${nid}` : "/workspace");
    },
    [router],
  );

  // Vista fantasma que sigue al puntero al arrastrar (DEF-034).
  const [dragGhost, setDragGhost] = useState<
    { kind: "nota" | "carpeta"; nombre: string; tipo?: NotaTipo } | null
  >(null);

  /**
   * DEF-023 P2: coordenada de pantalla del puntero durante un drag de dnd-kit. Se
   * calcula con el evento activador + el desplazamiento acumulado (mismo cálculo
   * que usa la detección de colisiones de dnd-kit, fiable aunque el ghost del
   * `DragOverlay` tape el DOM y bloquee `pointermove`/`elementFromPoint`).
   */
  function puntoDelDrag(event: DragMoveEvent | DragEndEvent): { x: number; y: number } {
    const act = event.activatorEvent as MouseEvent | null;
    return { x: (act?.clientX ?? 0) + event.delta.x, y: (act?.clientY ?? 0) + event.delta.y };
  }

  /** Limpia el estado transitorio del arrastre de una nota (DEF-023 P2). */
  function limpiarDragNota() {
    useTabsStore.getState().setDraggingNota(null);
    useTabsStore.getState().setNotaDropTarget(null);
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("nota:")) {
      const notaId = id.replace("nota:", "");
      const nota = store.notas.find((n) => n.id === notaId);
      if (nota) setDragGhost({ kind: "nota", nombre: nota.titulo, tipo: nota.tipo });
      // DEF-023 P2: avisa a los panes para que muestren el previo de drop.
      useTabsStore.getState().setDraggingNota(notaId);
    } else if (id.startsWith("carpeta:")) {
      const carpeta = store.carpetas.find((c) => c.id === id.replace("carpeta:", ""));
      if (carpeta) setDragGhost({ kind: "carpeta", nombre: carpeta.nombre });
    }
  }

  // DEF-023 P2: mientras se arrastra una nota, publica la zona bajo el puntero
  // (usando el tracking fiable de dnd-kit) para que el pane muestre el previo.
  function onDragMove(event: DragMoveEvent) {
    if (!String(event.active.id).startsWith("nota:")) return;
    const { x, y } = puntoDelDrag(event);
    useTabsStore.getState().setNotaDropTarget(paneObjetivoEnPunto(x, y));
  }

  function onDragEnd(event: DragEndEvent) {
    setDragGhost(null);
    const dragged = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;

    // Soltar una nota FUERA del explorador la abre en un pane (DEF-023 P2): borde
    // = dividir, centro = abrir como pestaña. La zona se recalcula por geometría
    // desde el punto final del drag (fiable pese al ghost del DragOverlay).
    if (!over && dragged.startsWith("nota:")) {
      const nota = store.notas.find((n) => n.id === dragged.replace("nota:", ""));
      const { x, y } = puntoDelDrag(event);
      const objetivo = nota ? paneObjetivoEnPunto(x, y) : null;
      if (nota && objetivo) {
        if (objetivo.edge === "center") {
          useTabsStore.getState().openNotaInPane(nota.id, objetivo.paneId);
        } else {
          useTabsStore.getState().splitPaneWithNota(nota.id, objetivo.paneId, objetivo.edge);
        }
        router.replace(`/workspace?note=${nota.id}`);
      }
      limpiarDragNota();
      return;
    }

    limpiarDragNota();
    if (!over) return;

    const destinoId = over === "root" ? null : over.replace("folder:", "");

    if (dragged.startsWith("nota:")) {
      const notaId = dragged.replace("nota:", "");
      const nota = store.notas.find((n) => n.id === notaId);
      if (nota && nota.carpetaId !== destinoId) void store.moveNota(notaId, destinoId);
    } else if (dragged.startsWith("carpeta:")) {
      const carpetaId = dragged.replace("carpeta:", "");
      const carpeta = store.carpetas.find((c) => c.id === carpetaId);
      if (!carpeta || carpeta.padreId === destinoId) return;
      // No mover dentro de sí misma ni de sus hijos (HU-24 CA6)
      if (destinoId !== null && store.subtreeIds(carpetaId).has(destinoId)) return;
      void store.moveCarpeta(carpetaId, destinoId);
    }
  }

  /**
   * Entrada "Nueva desde Espora ▸" del menú de una carpeta (FUN-M-03). Se arma
   * al abrir el menú, con las plantillas del momento; la nota se crea en
   * `carpetaId` (la carpeta del clic derecho), no en la carpeta activa.
   */
  function esporasMenu(carpetaId: string | null): MenuItem {
    const esporas = listarEsporas(store.notas);
    return {
      label: "Nueva desde Espora",
      disabled: esporas.length === 0,
      title:
        esporas.length === 0
          ? `No hay plantillas en «${carpetaEsporas()}». Creá la primera desde el panel de Esporas.`
          : "Crear una nota a partir de una plantilla",
      submenu: esporas.map((espora) => ({
        label: espora.titulo,
        onClick: () =>
          void crearNotaDesdeEspora(espora, carpetaId)
            .then(openNota)
            .catch((e) => console.error("[esporas] no se pudo crear la nota:", e)),
      })),
    };
  }

  /**
   * Crea un `.base` con una vista mínima ya escrita. Una base vacía no mostraría
   * nada y parecería rota; con esto se abre mostrando el vault entero, que es de
   * donde el usuario va a partir para filtrar.
   */
  async function crearBase(carpetaId: string | null) {
    const id = await store.createNota(carpetaId, "base");
    await api(`/notas/${encodeURIComponent(id)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido: baseInicial() },
    });
    openNota(id);
  }

  function carpetaMenu(carpeta: TreeCarpeta): MenuItem[] {
    return [
      {
        label: "Nueva nota",
        onClick: () => void store.createNota(carpeta.id).then(openNota),
      },
      {
        label: "Nuevo dibujo Excalidraw",
        onClick: () => void store.createNota(carpeta.id, "excalidraw").then(openNota),
      },
      // Base (FUN-L-03): una tabla que agrega notas por sus propiedades. Se crea
      // con una vista mínima ya escrita, para que muestre algo desde el principio.
      {
        label: "Nueva base",
        onClick: () => void crearBase(carpeta.id),
      },
      // Plantillas (FUN-M-03): crea EN ESTA carpeta, no en la activa. Sin
      // Esporas la entrada queda deshabilitada con el motivo, nunca oculta: es
      // la forma de que la funcionalidad se descubra.
      esporasMenu(carpeta.id),
      {
        label: "Nueva carpeta",
        onClick: () => {
          const nombre = window.prompt("Nombre de la carpeta:", "Nueva carpeta");
          if (nombre) void store.createCarpeta(nombre, carpeta.id);
        },
      },
      {
        label: "Importar archivos .md",
        onClick: () => {
          importTargetRef.current = carpeta.id;
          mdInputRef.current?.click();
        },
      },
      // Terminal integrada (FUN-L-07 CA4): solo en vault de carpeta, donde la
      // carpeta existe en disco (su id ES la ruta relativa).
      ...(rutaVault
        ? [
            {
              label: "Abrir terminal aquí",
              onClick: () => {
                const tabId = crearTerminal({ cwd: `${rutaVault}/${carpeta.id}` });
                router.replace(`/workspace?note=${encodeURIComponent(tabId)}`);
              },
            },
          ]
        : []),
      {
        label: "Compartir",
        onClick: () =>
          useUiStore.getState().setShareTarget({ id: carpeta.id, nombre: carpeta.nombre }),
      },
      {
        label: "Gestionar acceso",
        onClick: () =>
          useUiStore.getState().setShareTarget({ id: carpeta.id, nombre: carpeta.nombre }),
      },
      {
        label: "Renombrar",
        onClick: () =>
          setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre }),
      },
      ...(rutaVault
        ? [
            {
              label: "Mostrar en el explorador",
              onClick: () => void revelarEnSistema(rutaVault, carpeta.id),
            },
          ]
        : []),
      {
        label: "Eliminar",
        danger: true,
        onClick: () => {
          const subtree = store.subtreeIds(carpeta.id);
          const count = store.notas.filter(
            (n) => n.carpetaId !== null && subtree.has(n.carpetaId),
          ).length;
          const message =
            count > 0
              ? `Eliminar "${carpeta.nombre}" mandará ${count} nota(s) a la papelera. ¿Continuar?`
              : `¿Eliminar la carpeta "${carpeta.nombre}"?`;
          void confirmar(message).then((ok) => {
            if (ok) void store.deleteCarpeta(carpeta.id);
          });
        },
      },
    ];
  }

  function notaMenu(nota: TreeNota): MenuItem[] {
    return [
      {
        label: "Renombrar",
        onClick: () => setRenaming({ type: "nota", id: nota.id, valor: nota.titulo }),
      },
      { label: "Duplicar", onClick: () => void store.duplicateNota(nota.id) },
      {
        label: "Exportar como .md",
        onClick: () => void exportNoteMd(nota.id, nota.titulo),
      },
      {
        label: "Exportar como PDF…",
        onClick: () => exportNotePdfActive(nota.id, nota.titulo),
      },
      ...(rutaVault
        ? [
            {
              label: "Mostrar en el explorador",
              onClick: () => void revelarEnSistema(rutaVault, nota.id),
            },
          ]
        : []),
      {
        label: "Eliminar",
        danger: true,
        onClick: () => {
          useTabsStore.getState().closeNotaEverywhere(nota.id);
          void store.deleteNota(nota.id);
        },
      },
    ];
  }

  function commitRename() {
    if (!renaming) return;
    const valor = renaming.valor.trim();
    if (valor) {
      if (renaming.type === "carpeta") void store.renameCarpeta(renaming.id, valor);
      else void store.renameNota(renaming.id, valor);
    }
    setRenaming(null);
  }

  function renderCarpeta(carpeta: TreeCarpeta, depth: number) {
    const isExpanded = store.expanded[carpeta.id] ?? false;
    const isActive = store.activeFolderId === carpeta.id;

    return (
      <FolderDropZone
        key={carpeta.id}
        carpetaId={carpeta.id}
        onOsOver={() => setOsDropTarget(carpeta.id)}
        onOsFiles={(dt) => {
          setOsDropTarget(undefined);
          importarSoltados(dt, carpeta.id);
        }}
      >
        {(dropOver) => (
          <>
        <FolderRow
          carpeta={carpeta}
          depth={depth}
          expanded={isExpanded}
          active={isActive}
          dropOver={dropOver || osDropTarget === carpeta.id}
          shared={isCarpetaShared(carpeta.id)}
          renaming={renaming?.type === "carpeta" && renaming.id === carpeta.id}
          renameValue={renaming?.valor ?? ""}
          onRenameChange={(valor) => setRenaming((r) => (r ? { ...r, valor } : r))}
          onRenameCommit={commitRename}
          onRenameCancel={() => setRenaming(null)}
          onToggle={() => {
            store.toggleExpanded(carpeta.id);
            store.setActiveFolder(carpeta.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            store.setActiveFolder(carpeta.id);
            setMenu({ x: e.clientX, y: e.clientY, items: carpetaMenu(carpeta) });
          }}
          onDoubleClick={() =>
            setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre })
          }
        />
        {isExpanded && (
          <div>
            {(carpetasPorPadre.get(carpeta.id) ?? []).map((sub) =>
              renderCarpeta(sub, depth + 1),
            )}
            {(notasPorCarpeta.get(carpeta.id) ?? []).map((nota) =>
              renderNota(nota, depth + 1),
            )}
          </div>
        )}
          </>
        )}
      </FolderDropZone>
    );
  }

  function renderNota(nota: TreeNota, depth: number) {
    return (
      <NoteRow
        key={nota.id}
        nota={nota}
        depth={depth}
        active={activeNoteId === nota.id}
        shared={isCarpetaShared(nota.carpetaId)}
        renaming={renaming?.type === "nota" && renaming.id === nota.id}
        renameValue={renaming?.valor ?? ""}
        onRenameChange={(valor) => setRenaming((r) => (r ? { ...r, valor } : r))}
        onRenameCommit={commitRename}
        onRenameCancel={() => setRenaming(null)}
        onOpen={() => openNota(nota.id)}
        onOpenBackground={() => openNotaBackground(nota.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: notaMenu(nota) });
        }}
        onDoubleClick={() =>
          setRenaming({ type: "nota", id: nota.id, valor: nota.titulo })
        }
      />
    );
  }

  if (!vaultId) {
    return <p className={styles.empty}>Sin vault activo.</p>;
  }

  // DEF-036: importa los archivos soltados desde el SO en la carpeta DESTINO (la
  // que estaba bajo el cursor; `null` = raíz). Antes iba siempre a la carpeta
  // activa, ignorando dónde se soltó.
  const importarSoltados = (dataTransfer: DataTransfer, targetId: string | null) => {
    void collectFromDataTransfer(dataTransfer).then((files) => {
      const onlyMd = files.filter((f) => /\.md$/i.test(f.path) || !/\.[^/]+$/.test(f.path));
      if (onlyMd.length > 0) {
        useImportStore.getState().run(onlyMd, targetId, "Importación");
      }
    });
  };

  // Arrastre del divisor (DEF-023): el alto del panel Compartido = distancia del
  // cursor al borde inferior del explorador; Archivos ocupa el resto. Clamp para
  // dejar un mínimo a ambos. Se persiste al soltar.
  const onDivisorPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const cont = explorerRef.current;
    if (!cont) return;
    const onMove = (ev: PointerEvent) => {
      const rect = cont.getBoundingClientRect();
      const px = Math.round(rect.bottom - ev.clientY);
      const max = Math.max(60, rect.height - 160); // mínimo para Archivos
      setCompartidosPx(Math.max(60, Math.min(px, max)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setCompartidosPx((v) => {
        localStorage.setItem("mic-split-compartido", String(v));
        return v;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={explorerRef}
      className={`${styles.explorer} ${osDropTarget === null ? styles.osDragOver : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          // Raíz: si el cursor está sobre una carpeta, ese div hace stopPropagation
          // y fija su propio destino; aquí solo llega el área vacía/raíz.
          setOsDropTarget(null);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOsDropTarget(undefined);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const dt = e.dataTransfer;
        setOsDropTarget(undefined);
        importarSoltados(dt, null);
      }}
    >
      <input
        ref={mdInputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void useImportStore
              .getState()
              .run(collectFromFileList(e.target.files), importTargetRef.current, "Importación");
          }
          e.target.value = "";
        }}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          title="Nueva nota"
          onClick={() => void store.createNota(store.activeFolderId).then(openNota)}
        >
          <FilePlus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title="Nuevo dibujo Excalidraw"
          onClick={() => void store.createNota(store.activeFolderId, "excalidraw").then(openNota)}
        >
          <Shapes size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title="Nueva base (tabla de notas)"
          onClick={() => void crearBase(store.activeFolderId)}
        >
          <Table2 size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title="Nueva carpeta"
          onClick={() => {
            const nombre = window.prompt("Nombre de la carpeta:", "Nueva carpeta");
            if (nombre) void store.createCarpeta(nombre, store.activeFolderId);
          }}
        >
          <FolderPlus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title="Importar archivos .md"
          onClick={() => {
            importTargetRef.current = store.activeFolderId;
            mdInputRef.current?.click();
          }}
        >
          <Upload size={16} aria-hidden />
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={dropMasProfundo}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragGhost(null);
          limpiarDragNota();
        }}
      >
        {/* Panel "Archivos": ocupa el espacio libre y tiene su propio scroll. */}
        <div className={styles.paneArchivos}>
          <SectionHeader
            title="Archivos"
            collapsed={archivosCollapsed}
            onToggle={toggleArchivos}
          />
          {!archivosCollapsed && (
            <RootDropZone onClearActive={() => store.setActiveFolder(null)}>
              {(carpetasPorPadre.get(null) ?? []).map((carpeta) => renderCarpeta(carpeta, 0))}
              {(notasPorCarpeta.get(null) ?? []).map((nota) => renderNota(nota, 0))}
              {store.carpetas.length === 0 && store.notas.length === 0 && (
                <p className={styles.empty}>
                  Vault vacío. Creá tu primera nota con el botón de arriba.
                </p>
              )}
            </RootDropZone>
          )}
        </div>

        {/* Divisor arrastrable (DEF-023): solo con Compartido expandido. */}
        {!compartidosCollapsed && (
          <div
            className={styles.divisor}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Ajustar el tamaño de Compartido"
            onPointerDown={onDivisorPointerDown}
          />
        )}

        {/* Panel "Compartido": alto ajustable con su propio scroll; colapsado
            ocupa solo su cabecera. */}
        <div
          className={styles.paneCompartidos}
          style={
            compartidosCollapsed
              ? undefined
              : { height: `${compartidosPx}px`, overflowY: "auto", flexShrink: 0 }
          }
        >
          <SharedSection collapsed={compartidosCollapsed} onToggle={toggleCompartidos} />
        </div>

        {/* Sombra que sigue al puntero mientras se arrastra (DEF-034). */}
        <DragOverlay dropAnimation={null}>
          {dragGhost && (
            <div className={styles.dragGhost}>
              {dragGhost.kind === "carpeta" ? (
                <Folder size={15} className={styles.folderIcon} aria-hidden />
              ) : dragGhost.tipo === "excalidraw" ? (
                <Shapes size={15} className={styles.noteIcon} aria-hidden />
              ) : dragGhost.tipo === "base" ? (
                <Table2 size={15} className={styles.noteIcon} aria-hidden />
              ) : (
                <FileText size={15} className={styles.noteIcon} aria-hidden />
              )}
              <span className={styles.name}>{dragGhost.nombre}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Cabecera colapsable de una sección del explorador (estilo paneles de VSCode). */
export function SectionHeader({
  title,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={styles.sectionHeader} onClick={onToggle}>
      {collapsed ? (
        <ChevronRight size={13} aria-hidden />
      ) : (
        <ChevronDown size={13} aria-hidden />
      )}
      <span>{title}</span>
    </button>
  );
}

// ── Filas ────────────────────────────────────────────────────────

type RowRenameProps = {
  renaming: boolean;
  renameValue: string;
  onRenameChange: (valor: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
};

function RenameInput({
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: Omit<RowRenameProps, "renaming">) {
  return (
    <input
      className={styles.renameInput}
      value={renameValue}
      autoFocus
      onChange={(e) => onRenameChange(e.target.value)}
      onBlur={onRenameCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onRenameCommit();
        if (e.key === "Escape") onRenameCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Zona de drop de una carpeta: cubre su fila Y su contenido expandido, así
 * soltar en cualquier parte del área de la carpeta la toma como destino (antes
 * solo la fila era droppable y soltar en el hueco de los hijos caía en la raíz).
 * También recibe los archivos arrastrados desde el SO (DEF-036).
 */
function FolderDropZone({
  carpetaId,
  onOsOver,
  onOsFiles,
  children,
}: {
  carpetaId: string;
  onOsOver: () => void;
  onOsFiles: (dt: DataTransfer) => void;
  children: (dropOver: boolean) => React.ReactNode;
}) {
  const drop = useDroppable({ id: `folder:${carpetaId}` });
  return (
    <div
      ref={drop.setNodeRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation(); // la carpeta más interna bajo el cursor gana
          onOsOver();
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        onOsFiles(e.dataTransfer);
      }}
    >
      {children(drop.isOver)}
    </div>
  );
}

function FolderRow({
  carpeta,
  depth,
  expanded,
  active,
  shared,
  dropOver,
  onToggle,
  onContextMenu,
  onDoubleClick,
  ...rename
}: {
  carpeta: TreeCarpeta;
  depth: number;
  expanded: boolean;
  active: boolean;
  shared: boolean;
  /** Resaltado de destino: arrastre interno sobre la zona de la carpeta o
   *  archivos del SO sobre ella (DEF-036b). Lo decide `FolderDropZone`. */
  dropOver?: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `carpeta:${carpeta.id}` });

  const className = [
    styles.row,
    active ? styles.rowActive : "",
    dropOver ? styles.rowDropTarget : "",
    drag.isDragging ? styles.rowDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={drag.setNodeRef}
      className={className}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      {...drag.listeners}
      {...drag.attributes}
    >
      {expanded ? (
        <ChevronDown size={14} className={styles.chevron} aria-hidden />
      ) : (
        <ChevronRight size={14} className={styles.chevron} aria-hidden />
      )}
      <Folder size={15} className={styles.folderIcon} aria-hidden />
      {rename.renaming ? (
        <RenameInput {...rename} />
      ) : (
        <span className={styles.name}>{carpeta.nombre}</span>
      )}
      {shared && !rename.renaming && (
        <Users size={12} className={styles.sharedIcon} aria-label="Compartida" />
      )}
    </div>
  );
}

function NoteRow({
  nota,
  depth,
  active,
  shared,
  onOpen,
  onOpenBackground,
  onContextMenu,
  onDoubleClick,
  ...rename
}: {
  nota: TreeNota;
  depth: number;
  active: boolean;
  shared: boolean;
  onOpen: () => void;
  onOpenBackground: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `nota:${nota.id}` });
  // Un ícono por tipo de archivo: markdown, dibujo y base se distinguen de un
  // vistazo en el árbol (antes una base se veía igual que una nota).
  const Icon =
    nota.tipo === "excalidraw" ? Shapes : nota.tipo === "base" ? Table2 : FileText;

  const className = [
    styles.row,
    active ? styles.rowActive : "",
    drag.isDragging ? styles.rowDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={drag.setNodeRef}
      className={className}
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
      onClick={onOpen}
      // Evita el auto-scroll del navegador al pulsar la rueda sobre la fila.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onOpenBackground();
        }
      }}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      {...drag.listeners}
      {...drag.attributes}
    >
      <Icon size={15} className={styles.noteIcon} aria-hidden />
      {rename.renaming ? (
        <RenameInput {...rename} />
      ) : (
        <span className={styles.name}>{nota.titulo}</span>
      )}
      {shared && !rename.renaming && (
        <Users size={12} className={styles.sharedIcon} aria-label="Compartido" />
      )}
    </div>
  );
}

/** Zona raíz: soltar aquí mueve a la raíz del vault; clic limpia la carpeta activa. */
function RootDropZone({
  children,
  onClearActive,
}: {
  children: React.ReactNode;
  onClearActive: () => void;
}) {
  const drop = useDroppable({ id: "root" });
  return (
    <div
      ref={drop.setNodeRef}
      className={drop.isOver ? `${styles.tree} ${styles.treeDropTarget}` : styles.tree}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClearActive();
      }}
    >
      {children}
    </div>
  );
}
