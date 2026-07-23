"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Shapes,
  Upload,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { insertRefAtPoint } from "@/lib/editor/viewRegistry";
import { revelarEnSistema } from "@/lib/db/vaultFs";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
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
      router.push(`/workspace?note=${id}`);
    },
    [router],
  );

  // Clic con la rueda: abre la nota en segundo plano (sin robar el foco).
  const openNotaBackground = useCallback(
    (id: string) => {
      useTabsStore.getState().openNoteBackground(id);
      const nid = useTabsStore.getState().activeNotaId();
      router.push(nid ? `/workspace?note=${nid}` : "/workspace");
    },
    [router],
  );

  // Vista fantasma que sigue al puntero al arrastrar (DEF-034).
  const [dragGhost, setDragGhost] = useState<
    { kind: "nota" | "carpeta"; nombre: string; tipo?: NotaTipo } | null
  >(null);

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("nota:")) {
      const nota = store.notas.find((n) => n.id === id.replace("nota:", ""));
      if (nota) setDragGhost({ kind: "nota", nombre: nota.titulo, tipo: nota.tipo });
    } else if (id.startsWith("carpeta:")) {
      const carpeta = store.carpetas.find((c) => c.id === id.replace("carpeta:", ""));
      if (carpeta) setDragGhost({ kind: "carpeta", nombre: carpeta.nombre });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setDragGhost(null);
    const dragged = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;

    // Soltar una nota sobre un markdown abierto inserta su vínculo en el punto de
    // soltado (los archivos .excalidraw se insertan como embed para verse inline).
    if (!over && dragged.startsWith("nota:")) {
      const nota = store.notas.find((n) => n.id === dragged.replace("nota:", ""));
      if (nota) {
        const act = event.activatorEvent as MouseEvent | null;
        const x = (act?.clientX ?? 0) + event.delta.x;
        const y = (act?.clientY ?? 0) + event.delta.y;
        const ref =
          nota.tipo === "excalidraw"
            ? `![[${nota.titulo}.excalidraw]]`
            : `[[${nota.titulo}]]`;
        if (insertRefAtPoint(x, y, ref)) return;
      }
    }
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
          if (window.confirm(message)) void store.deleteCarpeta(carpeta.id);
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
        label: "Exportar como PDF (A4)",
        onClick: () => void exportNotePdfActive(nota.id, nota.titulo, "A4"),
      },
      {
        label: "Exportar como PDF (Letter)",
        onClick: () => void exportNotePdfActive(nota.id, nota.titulo, "Letter"),
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
      <div
        key={carpeta.id}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.stopPropagation(); // la carpeta más interna bajo el cursor gana
            setOsDropTarget(carpeta.id);
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          const dt = e.dataTransfer;
          setOsDropTarget(undefined);
          importarSoltados(dt, carpeta.id);
        }}
      >
        <FolderRow
          carpeta={carpeta}
          depth={depth}
          expanded={isExpanded}
          active={isActive}
          osDropOver={osDropTarget === carpeta.id}
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
      </div>
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

  return (
    <div
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

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragGhost(null)}>
        <RootDropZone onClearActive={() => store.setActiveFolder(null)}>
          <SectionHeader
            title="Archivos"
            collapsed={archivosCollapsed}
            onToggle={toggleArchivos}
          />
          {!archivosCollapsed && (
            <>
              {(carpetasPorPadre.get(null) ?? []).map((carpeta) => renderCarpeta(carpeta, 0))}
              {(notasPorCarpeta.get(null) ?? []).map((nota) => renderNota(nota, 0))}
              {store.carpetas.length === 0 && store.notas.length === 0 && (
                <p className={styles.empty}>
                  Vault vacío. Creá tu primera nota con el botón de arriba.
                </p>
              )}
            </>
          )}
          <SharedSection />
        </RootDropZone>

        {/* Sombra que sigue al puntero mientras se arrastra (DEF-034). */}
        <DragOverlay dropAnimation={null}>
          {dragGhost && (
            <div className={styles.dragGhost}>
              {dragGhost.kind === "carpeta" ? (
                <Folder size={15} className={styles.folderIcon} aria-hidden />
              ) : dragGhost.tipo === "excalidraw" ? (
                <Shapes size={15} className={styles.noteIcon} aria-hidden />
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

function FolderRow({
  carpeta,
  depth,
  expanded,
  active,
  shared,
  osDropOver,
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
  /** Resaltado cuando se arrastran archivos del SO sobre esta carpeta (DEF-036b). */
  osDropOver?: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `carpeta:${carpeta.id}` });
  const drop = useDroppable({ id: `folder:${carpeta.id}` });

  const className = [
    styles.row,
    active ? styles.rowActive : "",
    drop.isOver || osDropOver ? styles.rowDropTarget : "",
    drag.isDragging ? styles.rowDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
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
  const Icon = nota.tipo === "excalidraw" ? Shapes : FileText;

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
