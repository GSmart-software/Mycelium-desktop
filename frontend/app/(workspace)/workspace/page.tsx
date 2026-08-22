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
import { UpdateDialog } from "@/components/workspace/UpdateDialog";
import { useAuthStore } from "@/stores/authStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useCssStore } from "@/stores/cssStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useUiStore } from "@/stores/uiStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { AperturaVault } from "@/components/vault/AperturaVault";
import { rutaVaultPersistida, useVaultSessionStore } from "@/stores/vaultSessionStore";
import { listarOtrosArchivos } from "@/lib/otrosArchivos";
import { escucharCambiosVault } from "@/lib/vaultWatch";
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
  // Suscrito, no leído con `getState()`: si no, al cambiar `abriendo` este
  // componente no se volvería a pintar y la pantalla de carga no aparecería (ni
  // se iría) nunca.
  const abriendoVault = useVaultSessionStore((s) => s.abriendo);

  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;
    let cancelado = false;
    void (async () => {
      // Reabrir el vault si no hay uno abierto. Debe ocurrir ANTES de restore()
      // para fijar el executor.
      //
      // Dos orígenes, y el orden importa: `?vault=` lo pone la ventana NUEVA que
      // abre `FUN-L-16` —arranca con su `sessionStorage` vacío, así que el vault
      // tiene que viajar en la URL— y manda sobre lo persistido, que es de esta
      // ventana y de una sesión anterior.
      if (useVaultSessionStore.getState().rutaActual === null) {
        const pedido = new URLSearchParams(window.location.search).get("vault");
        const ruta = pedido ?? rutaVaultPersistida();
        if (ruta) {
          const ok = await useVaultSessionStore.getState().abrir(ruta);
          // Si no se pudo abrir, lo mas probable es que ya lo tenga otra
          // ventana (`FUN-L-16`): reclamarlo falla a proposito. En vez de
          // quedarse en un workspace sin vault, se va al selector para elegir
          // otro — que es lo unico util que se puede hacer desde aca.
          if (!ok && !cancelado) {
            router.replace("/vaults");
            return;
          }
        }
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
    // El vault también se abre solo al arrancar (ajuste "abrir el último"), y
    // ese camino mostraba un «Cargando…» mudo: el defecto pedía la misma
    // pantalla de carga en los dos (`DEF-042`).
    if (abriendoVault) return <AperturaVault />;
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
  const archivosReconciliadosRef = useRef(false);
  // Solo en modo carpeta (fase 5) hay watcher; en SQLite clásico `rutaActual` es null.
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);

  // Escuchar cambios EXTERNOS del vault en carpeta: el watcher nativo emite
  // `vault-cambios` y `escucharCambiosVault` reindexa (incremental) y refresca la
  // UI. Se re-suscribe si cambia la carpeta abierta y se limpia al desmontar/salir
  // para no duplicar listeners (fase 5, solo-desktop).
  useEffect(() => {
    if (!rutaVault) return;
    let dispose: (() => void) | null = null;
    let vigente = true;
    void escucharCambiosVault().then((unlisten) => {
      if (vigente) dispose = unlisten;
      else unlisten(); // se desmontó antes de resolver: limpiar de inmediato
    });
    return () => {
      vigente = false;
      dispose?.();
    };
  }, [rutaVault]);

  // Comprobación de actualizaciones (FUN-L-14). Va acá, en el shell ya montado,
  // y no en el arranque de la app: así el diálogo solo puede aparecer cuando
  // Mycelium ya es usable, nunca por delante de él. `comprobarAlArrancar` no
  // bloquea, decide sola si toca hoy y calla si no hay conexión, así que este
  // efecto es "dispararlo y olvidarse". Un pequeño retardo deja que el vault
  // termine de cargar antes de competir por la red y por la atención.
  useEffect(() => {
    const t = setTimeout(() => void useUpdaterStore.getState().comprobarAlArrancar(), 4000);
    return () => clearTimeout(t);
  }, []);

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
  //
  // Se exige que el árbol sea el de ESTE vault, no solo que no esté vacío
  // (`DEF-044`): es una operación destructiva, y corriéndola contra la lista del
  // vault anterior se llevaba por delante las pestañas recién restauradas.
  // Hoy `abrir()` ya vacía el árbol al cambiar de vault, así que esto no debería
  // poder pasar — pero la comprobación es de una línea y lo que hay al otro lado
  // es perder las pestañas del usuario.
  useEffect(() => {
    if (reconciledRef.current || notas.length === 0) return;
    if (useVaultStore.getState().vaultId !== vaultId) return;
    reconciledRef.current = true;
    useTabsStore.getState().reconcileNotes(new Set(notas.map((n) => n.id)));
  }, [notas, vaultId]);

  // Lo mismo para las pestañas de visor (`FUN-L-11`), que apuntan a archivos que
  // NO están en el índice: su lista válida hay que pedirla aparte, al mismo
  // comando que las lista en el explorador. Sin esto, un archivo borrado o
  // renombrado desde fuera dejaría una pestaña fantasma que falla al pintarse.
  //
  // Corre después del árbol y no en paralelo por lo mismo que arriba: es
  // destructivo, y con el vault todavía cambiando se llevaría por delante
  // pestañas recién restauradas.
  useEffect(() => {
    if (archivosReconciliadosRef.current || !rutaVault) return;
    archivosReconciliadosRef.current = true;
    void listarOtrosArchivos(rutaVault).then((lista) => {
      useTabsStore.getState().reconcileArchivos(new Set(lista.map((a) => a.ruta)));
    });
  }, [rutaVault]);

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
        return;
      }
      // Alt+←/→: historial de la pestaña activa (DEF-040). Si el editor ya
      // consumió la pulsación, no se duplica la acción.
      if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.defaultPrevented) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          navegarHistorialActivo(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          navegarHistorialActivo(1);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleLeft, toggleRight]);

  /**
   * Botones auxiliares del ratón (DEF-040): 3 = atrás, 4 = adelante. Hasta
   * ahora navegaban el historial del WEBVIEW (la pila de `router.push` de todas
   * las aperturas, global y sin relación con el pane), que es justamente lo que
   * hacía que "atrás" mostrara cualquier cosa — e incluso podía salirse del
   * workspace. Se cancelan en `mousedown`/`auxclick` (así Chromium no navega) y
   * se enrutan al historial de la pestaña activa.
   */
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      navegarHistorialActivo(event.button === 3 ? -1 : 1);
    }
    function onAuxClick(event: MouseEvent) {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    }
    window.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("auxclick", onAuxClick, { capture: true });
    return () => {
      window.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("auxclick", onAuxClick, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navegarHistorialActivo(delta: -1 | 1) {
    const { activePaneId, navegarHistorial } = useTabsStore.getState();
    navegarHistorial(activePaneId, delta);
    syncUrlWithTabs();
  }

  // `replace` y no `push` (DEF-040): con historial propio por pestaña, la pila
  // del WebView solo compite y confunde. La URL sigue reflejando la nota activa.
  function syncUrlWithTabs() {
    const nid = useTabsStore.getState().activeNotaId();
    router.replace(nid ? `/workspace?note=${nid}` : "/workspace");
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
      <UpdateDialog />
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
