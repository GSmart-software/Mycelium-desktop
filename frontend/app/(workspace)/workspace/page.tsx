"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { AppTopbar } from "@/components/workspace/AppTopbar";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { Rail } from "@/components/workspace/Rail";
import { RightPanel } from "@/components/workspace/RightPanel";
import { SettingsDrawer } from "@/components/workspace/SettingsDrawer";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./workspace.module.css";

export default function WorkspacePage() {
  return (
    <Suspense>
      <WorkspaceGuard />
    </Suspense>
  );
}

/** Guard de sesión: restaura desde la cookie de refresh o redirige a /login. */
function WorkspaceGuard() {
  const router = useRouter();
  const { user, initialized, restore } = useAuthStore();

  useEffect(() => {
    if (!initialized) {
      void restore().then((ok) => {
        if (!ok) router.replace("/login");
      });
    } else if (!user) {
      router.replace("/login");
    }
  }, [initialized, user, restore, router]);

  if (!user) {
    return (
      <main className={styles.loading}>
        <p>Cargando…</p>
      </main>
    );
  }

  return <WorkspaceShell />;
}

/**
 * Shell del workspace: grid de 4 columnas × 2 filas (docs/DESIGN_SYSTEM.md).
 * HU-38 (topbar) + HU-28 (rail) + HU-29 (paneles) + HU-20 (URL ?note=).
 */
function WorkspaceShell() {
  const searchParams = useSearchParams();
  const activeNoteId = searchParams.get("note");
  const activeNote = useVaultStore((s) =>
    activeNoteId ? s.notas.find((n) => n.id === activeNoteId) ?? null : null,
  );

  const { activeSection, leftWidth, rightOpen, rightWidth, toggleLeft, toggleRight } =
    usePanelLayoutStore();

  // Atajos de paneles (HU-29 CA2/CA3): Ctrl+\ y Ctrl+Shift+\
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.code !== "Backslash") return;
      event.preventDefault();
      if (event.shiftKey) {
        toggleRight();
      } else {
        toggleLeft();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleLeft, toggleRight]);

  return (
    <div
      className={styles.workspace}
      style={
        {
          "--mic-panel-left-width": activeSection !== null ? `${leftWidth}px` : "0px",
          "--mic-panel-right-width": rightOpen ? `${rightWidth}px` : "0px",
        } as React.CSSProperties
      }
    >
      <AppTopbar activeNoteTitle={activeNote?.titulo ?? null} />
      <Rail />
      <LeftPanel />
      <EditorArea activeNoteId={activeNoteId} />
      <RightPanel />
      <SettingsDrawer />
    </div>
  );
}

/** Área central: editor de la nota activa (multi-pane con tabs en Fase 5). */
function EditorArea({ activeNoteId }: { activeNoteId: string | null }) {
  return (
    <section className={styles.editorArea}>
      {activeNoteId ? (
        <NoteEditor key={activeNoteId} notaId={activeNoteId} />
      ) : (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Abrí una nota desde el explorador</p>
          <p className={styles.emptyHint}>
            Tu red de conocimiento crece desde el panel izquierdo.
          </p>
        </div>
      )}
    </section>
  );
}
