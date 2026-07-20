"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ImportDialogs } from "@/components/explorer/ImportDialogs";
import { ShareModal } from "@/components/explorer/ShareModal";
import { PaneTree } from "@/components/panes/PaneTree";
import { AppTopbar } from "@/components/workspace/AppTopbar";
import { FileOpenBridge } from "@/components/workspace/FileOpenBridge";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { Rail } from "@/components/workspace/Rail";
import { SettingsDrawer } from "@/components/workspace/SettingsDrawer";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useCssStore } from "@/stores/cssStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useUiStore } from "@/stores/uiStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { rutaVaultPersistida, useVaultSessionStore } from "@/stores/vaultSessionStore";
import styles from "./workspace.module.css";

export default function WorkspacePage() {
  return (
    <Suspense>
      <FileOpenBridge />
      <WorkspaceGuard />
    </Suspense>
  );
}

/**
 * Guard del vault local: prepara la sesión al cargar. En modo carpeta (fase 3),
 * si se entra directo a `/workspace` tras una recarga y no hay vault abierto en
 * runtime pero sí uno persistido, primero reabre ese vault (abre su índice) y
 * LUEGO restaura la sesión, para que la capa de datos apunte a la carpeta y no
 * a `mycelium.db`. Si no hay vault ni sesión disponible, ofrece elegir uno.
 */
function WorkspaceGuard() {
  const router = useRouter();
  const { user, initialized, error, restore } = useAuthStore();
  const [retrying, setRetrying] = useState(false);
  const [preparando, setPreparando] = useState(true);
  const bootstrapRef = useRef(false);

  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;
    let cancelado = false;
    void (async () => {
      // Reabrir el vault persistido si no hay uno abierto (entrada directa tras
      // recarga). Debe ocurrir ANTES de restore() para fijar el executor.
      if (useVaultSessionStore.getState().rutaActual === null) {
        const persistida = rutaVaultPersistida();
        if (persistida) await useVaultSessionStore.getState().abrir(persistida);
      }
      if (!cancelado && !useAuthStore.getState().initialized) {
        await useAuthStore.getState().restore();
      }
      if (!cancelado) setPreparando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  // Aplicar tema, modo oscuro, tipografía y CSS propio al abrir el vault (HU-12/14/13)
  useEffect(() => {
    if (user) {
      usePreferencesStore.getState().hydrateFromUser();
      void useCssStore.getState().load();
    }
  }, [user]);

  if (!user) {
    if (initialized && !preparando) {
      return (
        <main className={styles.loading}>
          <div className={styles.errorBox} role="alert">
            <p className={styles.errorTitle}>No se pudo abrir el vault local.</p>
            {error && <p className={styles.errorDetail}>{error}</p>}
            <div className={styles.errorActions}>
              <button
                type="button"
                className={styles.retryButton}
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void restore().finally(() => setRetrying(false));
                }}
              >
                {retrying ? "Reintentando…" : "Reintentar"}
              </button>
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => router.replace("/vaults")}
              >
                Elegir vault
              </button>
            </div>
          </div>
        </main>
      );
    }
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeNoteId = searchParams.get("note");
  const activeNote = useVaultStore((s) =>
    activeNoteId ? s.notas.find((n) => n.id === activeNoteId) ?? null : null,
  );
  const carpetas = useVaultStore((s) => s.carpetas);
  const shareFolder = activeNote?.carpetaId
    ? {
        id: activeNote.carpetaId,
        nombre: carpetas.find((c) => c.id === activeNote.carpetaId)?.nombre ?? "carpeta",
      }
    : null;

  const { activeSection, leftWidth, toggleLeft, toggleRight } = usePanelLayoutStore();
  const vaultId = useAuthStore((s) => s.vaults[0]?.id) ?? null;
  const notas = useVaultStore((s) => s.notas);
  const reconciledRef = useRef(false);

  // Cargar el árbol del vault al entrar, aunque el explorador esté colapsado:
  // hace falta para los títulos de las pestañas y para reconciliar el layout
  // restaurado. Idempotente (treeSeq descarta recargas solapadas).
  useEffect(() => {
    if (vaultId && useVaultStore.getState().vaultId !== vaultId) {
      void useVaultStore.getState().loadTree(vaultId);
    }
  }, [vaultId]);

  // Una vez cargado el árbol, descartar del layout restaurado las pestañas cuyas
  // notas ya no existen (borradas mientras el sistema estaba cerrado).
  useEffect(() => {
    if (reconciledRef.current || notas.length === 0) return;
    reconciledRef.current = true;
    useTabsStore.getState().reconcileNotes(new Set(notas.map((n) => n.id)));
  }, [notas]);

  // La URL es la fuente de navegación (HU-20): abrir la nota en el pane activo
  useEffect(() => {
    if (activeNoteId) useTabsStore.getState().openNote(activeNoteId);
  }, [activeNoteId]);

  // Atajos de paneles (HU-29) y de pestañas (HU-25 CA4/CA7)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ctrl/Cmd+F abre la búsqueda en la nota, no el buscador del navegador.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        useUiStore.getState().setSearchInNoteOpen(true);
        return;
      }
      if (event.ctrlKey && event.code === "Backslash") {
        event.preventDefault();
        if (event.shiftKey) toggleRight();
        else toggleLeft();
        return;
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        useTabsStore.getState().closeActiveTab();
        syncUrlWithTabs();
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        useTabsStore.getState().reopenLastClosed();
        syncUrlWithTabs();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleLeft, toggleRight]);

  function syncUrlWithTabs() {
    const nid = useTabsStore.getState().activeNotaId();
    router.push(nid ? `/workspace?note=${nid}` : "/workspace");
  }

  return (
    <div
      className={styles.workspace}
      style={
        {
          "--mic-panel-left-width": activeSection !== null ? `${leftWidth}px` : "0px",
        } as React.CSSProperties
      }
    >
      <AppTopbar shareFolder={shareFolder} />
      <Rail />
      <LeftPanel />
      <EditorArea />
      <SettingsDrawer />
      <ImportDialogs />
      <ShareModal />
    </div>
  );
}

/** Área central: árbol de panes con pestañas (HU-25/26/27). */
function EditorArea() {
  const root = useTabsStore((s) => s.root);
  return (
    <section className={styles.editorArea}>
      <PaneTree node={root} />
    </section>
  );
}
