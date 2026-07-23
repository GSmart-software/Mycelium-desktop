"use client";

import { ChevronDown, ChevronRight, FileText, Folder, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import styles from "./ExplorerPanel.module.css";

type SharedCarpeta = { id: string; padreId: string | null; nombre: string };
type SharedNota = { id: string; carpetaId: string | null; titulo: string };
type Compartido = {
  id: string;
  nombre: string;
  vaultNombre: string;
  rol: string;
  carpetas: SharedCarpeta[];
  notas: SharedNota[];
};

/**
 * Sección "Compartido" del explorer (HU-35 CA4): carpetas que otros usuarios
 * compartieron con el usuario actual, en árbol de solo lectura de navegación.
 * Se refresca al montar y al volver el foco a la ventana (aprox. de CA4).
 */
export function SharedSection({
  collapsed,
  onToggle,
}: {
  /** Colapso elevado al ExplorerPanel para coordinar la división redimensionable (DEF-023). */
  collapsed: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Compartido[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await api<{ compartidos: Compartido[] }>("/compartido", {
        token: useAuthStore.getState().accessToken,
      });
      setItems(data.compartidos);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const open = (notaId: string) => {
    useTabsStore.getState().openNote(notaId);
    router.push(`/workspace?note=${notaId}`);
  };

  // Clic con la rueda: abre la nota compartida en una pestaña nueva sin robar el
  // foco (igual que en el explorador normal — DEF-033).
  const openBackground = (notaId: string) => {
    useTabsStore.getState().openNoteBackground(notaId);
    const nid = useTabsStore.getState().activeNotaId();
    router.push(nid ? `/workspace?note=${nid}` : "/workspace");
  };

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const renderTree = (
    comp: Compartido,
    carpetaId: string,
    depth: number,
  ): React.ReactNode => {
    const subCarpetas = comp.carpetas.filter((c) => c.padreId === carpetaId);
    const notas = comp.notas.filter((n) => n.carpetaId === carpetaId);
    return (
      <>
        {subCarpetas.map((c) => {
          const isOpen = expanded[c.id] ?? false;
          return (
            <div key={c.id}>
              <div
                className={styles.row}
                style={{ paddingLeft: `${depth * 14 + 4}px` }}
                onClick={() => toggle(c.id)}
              >
                {isOpen ? (
                  <ChevronDown size={14} className={styles.chevron} aria-hidden />
                ) : (
                  <ChevronRight size={14} className={styles.chevron} aria-hidden />
                )}
                <Folder size={15} className={styles.folderIcon} aria-hidden />
                <span className={styles.name}>{c.nombre}</span>
              </div>
              {isOpen && renderTree(comp, c.id, depth + 1)}
            </div>
          );
        })}
        {notas.map((n) => (
          <div
            key={n.id}
            className={styles.row}
            style={{ paddingLeft: `${depth * 14 + 22}px` }}
            onClick={() => open(n.id)}
            // Evita el auto-scroll del navegador al pulsar la rueda sobre la fila.
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                openBackground(n.id);
              }
            }}
          >
            <FileText size={15} className={styles.noteIcon} aria-hidden />
            <span className={styles.name}>{n.titulo}</span>
            <Users size={12} className={styles.sharedIcon} aria-hidden />
          </div>
        ))}
      </>
    );
  };

  return (
    <div className={styles.sharedSection}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        {collapsed ? (
          <ChevronRight size={13} aria-hidden />
        ) : (
          <ChevronDown size={13} aria-hidden />
        )}
        <span>Compartido</span>
      </button>
      {collapsed ? null : items.length === 0 ? (
        <p className={styles.empty}>Nada compartido todavía.</p>
      ) : (
        items.map((comp) => {
        const isOpen = expanded[comp.id] ?? true;
        return (
          <div key={comp.id}>
            <div className={styles.row} onClick={() => toggle(comp.id)} title={`${comp.vaultNombre} · ${comp.rol}`}>
              {isOpen ? (
                <ChevronDown size={14} className={styles.chevron} aria-hidden />
              ) : (
                <ChevronRight size={14} className={styles.chevron} aria-hidden />
              )}
              <Folder size={15} className={styles.folderIcon} aria-hidden />
              <span className={styles.name}>{comp.nombre}</span>
              <Users size={12} className={styles.sharedIcon} aria-hidden />
            </div>
            {isOpen && renderTree(comp, comp.id, 1)}
          </div>
        );
        })
      )}
    </div>
  );
}
