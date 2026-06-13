"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Upload,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { collectFromDataTransfer, collectFromFileList } from "@/lib/import";
import { useAuthStore } from "@/stores/authStore";
import { useImportStore } from "@/stores/importStore";
import { useTabsStore } from "@/stores/tabsStore";
import {
  useVaultStore,
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
  const store = useVaultStore();
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<RenameState>(null);
  const [osDragOver, setOsDragOver] = useState(false);
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

  function onDragEnd(event: DragEndEvent) {
    const dragged = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
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
        label: "Renombrar",
        onClick: () =>
          setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre }),
      },
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
      <div key={carpeta.id}>
        <FolderRow
          carpeta={carpeta}
          depth={depth}
          expanded={isExpanded}
          active={isActive}
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
        renaming={renaming?.type === "nota" && renaming.id === nota.id}
        renameValue={renaming?.valor ?? ""}
        onRenameChange={(valor) => setRenaming((r) => (r ? { ...r, valor } : r))}
        onRenameCommit={commitRename}
        onRenameCancel={() => setRenaming(null)}
        onOpen={() => openNota(nota.id)}
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

  const onOsDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setOsDragOver(false);
    void collectFromDataTransfer(event.dataTransfer).then((files) => {
      const onlyMd = files.filter((f) => /\.md$/i.test(f.path) || !/\.[^/]+$/.test(f.path));
      if (onlyMd.length > 0) {
        useImportStore.getState().run(onlyMd, store.activeFolderId, "Importación");
      }
    });
  };

  return (
    <div
      className={`${styles.explorer} ${osDragOver ? styles.osDragOver : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOsDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOsDragOver(false);
      }}
      onDrop={onOsDrop}
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

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <RootDropZone onClearActive={() => store.setActiveFolder(null)}>
          {(carpetasPorPadre.get(null) ?? []).map((carpeta) => renderCarpeta(carpeta, 0))}
          {(notasPorCarpeta.get(null) ?? []).map((nota) => renderNota(nota, 0))}
          {store.carpetas.length === 0 && store.notas.length === 0 && (
            <p className={styles.empty}>
              Vault vacío. Creá tu primera nota con el botón de arriba.
            </p>
          )}
        </RootDropZone>
      </DndContext>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
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
  onToggle,
  onContextMenu,
  onDoubleClick,
  ...rename
}: {
  carpeta: TreeCarpeta;
  depth: number;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `carpeta:${carpeta.id}` });
  const drop = useDroppable({ id: `folder:${carpeta.id}` });

  const className = [
    styles.row,
    active ? styles.rowActive : "",
    drop.isOver ? styles.rowDropTarget : "",
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
    </div>
  );
}

function NoteRow({
  nota,
  depth,
  active,
  onOpen,
  onContextMenu,
  onDoubleClick,
  ...rename
}: {
  nota: TreeNota;
  depth: number;
  active: boolean;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `nota:${nota.id}` });

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
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      {...drag.listeners}
      {...drag.attributes}
    >
      <FileText size={15} className={styles.noteIcon} aria-hidden />
      {rename.renaming ? (
        <RenameInput {...rename} />
      ) : (
        <span className={styles.name}>{nota.titulo}</span>
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
