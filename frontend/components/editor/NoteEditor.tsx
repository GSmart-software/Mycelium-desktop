"use client";

import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { search } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { wrapSelection } from "@/lib/editor/commands";
import { startCollab, type CollabHandle } from "@/lib/collab/collab";
import { addCodeCopyButtons } from "@/lib/codeCopy";
import { publishDoc, subscribeDoc } from "@/lib/editor/docBroker";
import { takePendingMatch } from "@/lib/editor/pendingMatch";
import { liveExtensions } from "@/lib/editor/livePreview";
import {
  markMissingWikilinks,
  resolveWikilink,
  wikilinkCompletions,
} from "@/lib/editor/wikilink";
import { registerView, unregisterView } from "@/lib/editor/viewRegistry";
import { exportDiagram, renderExcalidrawIn, saveDiagram } from "@/lib/excalidraw";
import { getCachedNote, putCachedNote } from "@/lib/idb";
import { renderMarkdown } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { ContextMenu, type MenuItem } from "@/components/explorer/ContextMenu";
import { ExcalidrawModal } from "./ExcalidrawModal";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useSyncStore } from "@/stores/syncStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUiStore } from "@/stores/uiStore";
import { EditorToolbar, type EditorMode, type SyncState } from "./EditorToolbar";
import { SearchBar } from "./SearchBar";
import styles from "./NoteEditor.module.css";

const MODES: EditorMode[] = ["live", "split", "read", "raw"];
const SYNC_INTERVAL_MS = 10_000; // throttle de sync a R2 (HU-04 CA8)
const LOCAL_SAVE_DEBOUNCE_MS = 250; // persistencia en IndexedDB < 500 ms (CA1)
const PREVIEW_DEBOUNCE_MS = 130; // re-render del preview (HU-01 CA3)

/** Cursor y scroll por pestaña mientras está abierta (HU-25 CA10). */
const instanceCache = new Map<
  string,
  { doc: string; anchor: number; head: number; scrollTop: number }
>();

/** Marcador de tarea por línea: indentación + viñeta + `[ ]`/`[x]`. */
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm;

/**
 * Alterna el N-ésimo checkbox de tarea del documento (orden de aparición, que
 * coincide con el orden renderizado). Despacha el cambio al editor, lo que
 * re-renderiza el preview y dispara el autoguardado.
 */
function toggleTaskInDoc(view: EditorView | null, index: number) {
  if (!view) return;
  const text = view.state.doc.toString();
  TASK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = TASK_RE.exec(text)) !== null) {
    if (i === index) {
      const pos = match.index + match[1].length + 1; // char dentro de los corchetes
      view.dispatch({
        changes: { from: pos, to: pos + 1, insert: match[2] === " " ? "x" : " " },
      });
      return;
    }
    i++;
  }
}

/** Selecciona y centra la primera coincidencia de `term` en la vista (HU-21 CA8). */
function gotoMatch(view: EditorView, term: string) {
  if (!term) return;
  const idx = view.state.doc.toString().toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return;
  view.dispatch({
    selection: { anchor: idx, head: idx + term.length },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Editor de una nota (HU-01/02/04/19): CodeMirror 6 con live preview por
 * línea, modos live/split/read/raw, autoguardado en IndexedDB y sync
 * throttled con el backend. Multi-instancia: la misma nota en dos panes
 * se mantiene espejada vía docBroker (HU-25/26 CA6).
 */
export function NoteEditor({
  notaId,
  instanceId = notaId,
  paneId = "main",
  isActivePane = true,
}: {
  notaId: string;
  instanceId?: string;
  paneId?: string;
  isActivePane?: boolean;
}) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveCompartment = useRef(new Compartment());
  const collabCompartment = useRef(new Compartment());
  const collabRef = useRef<CollabHandle | null>(null);
  const brokerApplyRef = useRef(false);

  const [mode, setModeState] = useState<EditorMode>(() => {
    if (typeof window === "undefined") return "live";
    const saved = window.localStorage.getItem(`micelio-mode-${notaId}`);
    return MODES.includes(saved as EditorMode) ? (saved as EditorMode) : "live";
  });
  const [syncState, setSyncStateLocal] = useState<SyncState>("local");
  const setSyncState = useCallback(
    (state: SyncState) => {
      setSyncStateLocal(state);
      useSyncStore.getState().setSyncState(notaId, state);
    },
    [notaId],
  );
  const [previewHtml, setPreviewHtml] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [editingDiag, setEditingDiag] = useState<string | null>(null);
  const [diagMenu, setDiagMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [previewTick, setPreviewTick] = useState(0);

  const modeRef = useRef(mode);
  const contentRef = useRef("");
  const dirtyRef = useRef(false);
  const remoteUpdatedAtRef = useRef<string | null>(null);
  const conflictUpdatedAtRef = useRef<string | null>(null);
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);

  const openByTitle = useCallback(
    (title: string) => {
      const { notas, carpetas } = useVaultStore.getState();
      // Acepta `título` o `Carpeta/título` para desambiguar homónimos.
      const target = resolveWikilink(title, notas, carpetas);
      if (target) {
        useTabsStore.getState().openNote(target.id);
        router.push(`/workspace?note=${target.id}`);
      }
    },
    [router],
  );

  // ¿Existe el archivo referenciado por un wikilink? (feedback de inexistencia)
  const noteExists = useCallback((target: string) => {
    const { notas, carpetas } = useVaultStore.getState();
    return resolveWikilink(target, notas, carpetas) !== undefined;
  }, []);

  // ── Persistencia local + sync ───────────────────────────────────

  const saveLocal = useCallback(() => {
    void putCachedNote({
      notaId,
      content: contentRef.current,
      savedAt: Date.now(),
      dirty: dirtyRef.current,
      remoteUpdatedAt: remoteUpdatedAtRef.current,
    });
  }, [notaId]);

  const syncNow = useCallback(async () => {
    if (!dirtyRef.current || syncingRef.current) return;
    syncingRef.current = true;
    setSyncState("syncing");
    try {
      const result = await api<{ actualizadoEn: string }>(
        `/notas/${notaId}/contenido`,
        {
          method: "PUT",
          token: useAuthStore.getState().accessToken,
          body: { contenido: contentRef.current },
        },
      );
      dirtyRef.current = false;
      remoteUpdatedAtRef.current = result.actualizadoEn;
      saveLocal();
      setSyncState("synced");
      // El contenido (y por ende los [[enlaces]]) cambió → refrescar el grafo.
      useGraphStore.getState().markStale();
    } catch {
      setSyncState(navigator.onLine ? "error" : "offline");
    } finally {
      syncingRef.current = false;
    }
  }, [notaId, saveLocal]);

  const onDocChanged = useCallback(
    (doc: string) => {
      contentRef.current = doc;
      dirtyRef.current = true;
      setSyncState("local");

      if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
      localSaveTimer.current = setTimeout(saveLocal, LOCAL_SAVE_DEBOUNCE_MS);

      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => {
        if (modeRef.current === "split" || modeRef.current === "read") {
          setPreviewHtml(renderMarkdown(contentRef.current));
        }
      }, PREVIEW_DEBOUNCE_MS);
    },
    [saveLocal],
  );

  // ── Editor ──────────────────────────────────────────────────────

  const createView = useCallback(
    (content: string) => {
      if (viewRef.current || !hostRef.current) return;
      contentRef.current = content;

      const formatKeymap = keymap.of([
        { key: "Mod-b", run: (v) => (wrapSelection(v, "**"), true) },
        { key: "Mod-i", run: (v) => (wrapSelection(v, "*"), true) },
        { key: "Mod-Shift-c", run: (v) => (wrapSelection(v, "`"), true) },
        {
          key: "Mod-k",
          run: () => {
            window.dispatchEvent(new CustomEvent("micelio:link-popover"));
            return true;
          },
        },
        {
          key: "Mod-f",
          run: () => {
            useUiStore.getState().setSearchInNoteOpen(true);
            return true;
          },
        },
      ]);

      viewRef.current = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: content,
          extensions: [
            history(),
            // Tab/Shift+Tab indentan la línea (sangría) en vez de mover el foco.
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            formatKeymap,
            // Panel propio: la UI real es SearchBar (HU-31); el panel nativo
            // se reemplaza por un nodo vacío para activar el resaltado.
            search({ createPanel: () => ({ dom: document.createElement("div") }) }),
            markdown({ extensions: GFM, codeLanguages: languages }),
            // Autocompletado de wikilinks al escribir dentro de `[[` (estilo
            // Obsidian); inserta la ruta de carpeta si el nombre es ambiguo.
            autocompletion({ override: [wikilinkCompletions] }),
            EditorView.lineWrapping,
            placeholder("Escribí tu nota…"),
            liveCompartment.current.of(
              modeRef.current === "live" ? liveExtensions(openByTitle, noteExists) : [],
            ),
            // Colaboración en vivo (HU-05/06/37); vacío salvo en notas
            // compartidas con relay disponible (cloudflare).
            collabCompartment.current.of([]),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              const doc = update.state.doc.toString();
              if (brokerApplyRef.current) {
                // Cambio venido de otra instancia de la misma nota
                contentRef.current = doc;
                if (modeRef.current === "split" || modeRef.current === "read") {
                  setPreviewHtml(renderMarkdown(doc));
                }
                return;
              }
              onDocChanged(doc);
              publishDoc(notaId, instanceId, doc);
              // Editar fija la pestaña de preview como permanente (Obsidian).
              if (
                update.transactions.some(
                  (tr) =>
                    tr.isUserEvent("input") ||
                    tr.isUserEvent("delete") ||
                    tr.isUserEvent("move"),
                )
              ) {
                useTabsStore.getState().pinTab(paneId, instanceId);
              }
            }),
          ],
        }),
      });

      registerView(paneId, viewRef.current);

      // Intentar colaboración en tiempo real (inerte en local; HU-05/06/37)
      if (!collabRef.current) {
        void startCollab(notaId, viewRef.current, collabCompartment.current, content).then(
          (handle) => {
            collabRef.current = handle;
          },
        );
      }

      // Restaurar cursor y scroll de la pestaña (HU-25 CA10)
      const cached = instanceCache.get(instanceId);
      if (cached && cached.doc === content) {
        const docLength = viewRef.current.state.doc.length;
        viewRef.current.dispatch({
          selection: {
            anchor: Math.min(cached.anchor, docLength),
            head: Math.min(cached.head, docLength),
          },
        });
        viewRef.current.scrollDOM.scrollTop = cached.scrollTop;
      }

      setPreviewHtml(renderMarkdown(content));

      // Si se abrió desde la búsqueda global, saltar a la coincidencia (HU-21 CA8)
      const pendingTerm = takePendingMatch(notaId);
      if (pendingTerm) gotoMatch(viewRef.current, pendingTerm);
    },
    [onDocChanged, openByTitle, noteExists, notaId, instanceId, paneId],
  );

  const applyContent = useCallback((content: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, []);

  // ── Carga inicial: IndexedDB primero (HU-19), remoto después ───

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cached = await getCachedNote(notaId);
      if (cancelled) return;

      // El doc de la pestaña (si quedó cacheado) es la versión más fresca
      const instance = instanceCache.get(instanceId);

      if (cached) {
        dirtyRef.current = cached.dirty;
        remoteUpdatedAtRef.current = cached.remoteUpdatedAt;
        createView(instance?.doc ?? cached.content);
        setSyncState(cached.dirty ? "local" : "synced");
      } else if (instance) {
        createView(instance.doc);
      }

      try {
        const remote = await api<{ contenido: string; actualizadoEn: string }>(
          `/notas/${notaId}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        if (cancelled) return;

        if (!cached && viewRef.current) {
          // Solo había estado de pestaña; el remoto define la base de sync
          remoteUpdatedAtRef.current = remote.actualizadoEn;
          saveLocal();
          setSyncState(dirtyRef.current ? "local" : "synced");
        } else if (!cached) {
          remoteUpdatedAtRef.current = remote.actualizadoEn;
          createView(remote.contenido);
          saveLocal();
          setSyncState("synced");
        } else if (remote.actualizadoEn !== cached.remoteUpdatedAt) {
          if (!cached.dirty) {
            // Versión remota más nueva, sin cambios locales → se aplica (HU-19 CA3)
            remoteUpdatedAtRef.current = remote.actualizadoEn;
            applyContent(remote.contenido);
            dirtyRef.current = false;
            saveLocal();
            setSyncState("synced");
          } else {
            // Cambios locales + remoto más nuevo → notificación no bloqueante (HU-04 CA5)
            conflictUpdatedAtRef.current = remote.actualizadoEn;
            setConflict(remote.contenido);
          }
        }
      } catch {
        if (!cancelled) {
          if (!viewRef.current) createView("");
          setSyncState(navigator.onLine ? "error" : "offline");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      // Al abandonar la nota: sync inmediato si hay cambios (HU-04 CA2)
      if (dirtyRef.current) {
        saveLocal();
        void syncNow();
      }
      collabRef.current?.destroy();
      collabRef.current = null;
      const view = viewRef.current;
      if (view) {
        // Cursor/scroll de la pestaña para restaurar al volver (HU-25 CA10)
        const { anchor, head } = view.state.selection.main;
        instanceCache.set(instanceId, {
          doc: contentRef.current,
          anchor,
          head,
          scrollTop: view.scrollDOM.scrollTop,
        });
        unregisterView(paneId, view);
        view.destroy();
      }
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaId]);

  // Salto a coincidencia cuando la nota ya estaba abierta (HU-21 CA8)
  useEffect(() => {
    function onGoto(event: Event) {
      const detail = (event as CustomEvent<{ notaId: string; term: string }>).detail;
      if (detail?.notaId !== notaId) return;
      const view = viewRef.current;
      if (!view) return;
      takePendingMatch(notaId);
      gotoMatch(view, detail.term);
    }
    window.addEventListener("micelio:goto-match", onGoto);
    return () => window.removeEventListener("micelio:goto-match", onGoto);
  }, [notaId]);

  // Espejo en tiempo real con otras instancias de la misma nota
  useEffect(() => {
    return subscribeDoc(notaId, instanceId, (content) => {
      if (content === contentRef.current) return;
      brokerApplyRef.current = true;
      applyContent(content);
      brokerApplyRef.current = false;
    });
  }, [notaId, instanceId, applyContent]);

  // ── Sync periódico + reconexión + beforeunload ──────────────────

  useEffect(() => {
    const interval = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const onOnline = () => void syncNow();
    const onBeforeUnload = () => {
      if (dirtyRef.current) {
        const token = useAuthStore.getState().accessToken;
        void fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5279"}/notas/${notaId}/contenido`,
          {
            method: "PUT",
            keepalive: true,
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ contenido: contentRef.current }),
          },
        );
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [notaId, syncNow]);

  // ── Modos (HU-02 CA9/CA10/CA11) ─────────────────────────────────

  const setMode = useCallback(
    (next: EditorMode) => {
      setModeState(next);
      modeRef.current = next;
      window.localStorage.setItem(`micelio-mode-${notaId}`, next);
      viewRef.current?.dispatch({
        effects: liveCompartment.current.reconfigure(
          next === "live" ? liveExtensions(openByTitle, noteExists) : [],
        ),
      });
      if (next === "split" || next === "read") {
        setPreviewHtml(renderMarkdown(contentRef.current));
      }
    },
    [notaId, openByTitle, noteExists],
  );

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!isActivePane) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.shiftKey || event.altKey) return;
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      if (index >= 0) {
        event.preventDefault();
        setMode(MODES[index]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setMode, isActivePane]);

  // Diagramas Mermaid (HU-18) y Excalidraw (HU-16) en el preview
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      void renderMermaidIn(previewRef.current);
      void renderExcalidrawIn(previewRef.current, notaId);
      addCodeCopyButtons(previewRef.current); // botón copiar en bloques de código
    }
  }, [previewHtml, mode, previewTick, notaId]);

  // Feedback de inexistencia: oscurece los wikilinks a archivos que no existen.
  // Reacciona a cambios del vault (crear/renombrar/borrar/mover) via suscripción.
  const vaultNotas = useVaultStore((s) => s.notas);
  const vaultCarpetas = useVaultStore((s) => s.carpetas);
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      markMissingWikilinks(previewRef.current, vaultNotas, vaultCarpetas);
    }
  }, [previewHtml, mode, previewTick, vaultNotas, vaultCarpetas]);

  /** Inserta un diagrama nuevo en el cursor (HU-16 CA1a). */
  const insertDiagram = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const diagId = crypto.randomUUID();
    void saveDiagram(notaId, diagId, { elements: [] }).then(() => {
      const { from } = view.state.selection.main;
      view.dispatch({
        changes: { from, insert: `![[${diagId}.excalidraw]]` },
      });
      setEditingDiag(diagId);
    });
  }, [notaId]);

  // Scroll sincronizado en split (HU-01 CA11)
  useEffect(() => {
    if (mode !== "split") return;
    const scroller = viewRef.current?.scrollDOM;
    const preview = previewRef.current;
    if (!scroller || !preview) return;

    let syncing = false;
    const link = (source: HTMLElement, target: HTMLElement) => () => {
      if (syncing) return;
      syncing = true;
      const ratio =
        source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
      requestAnimationFrame(() => (syncing = false));
    };

    const onEditorScroll = link(scroller, preview);
    const onPreviewScroll = link(preview, scroller);
    scroller.addEventListener("scroll", onEditorScroll);
    preview.addEventListener("scroll", onPreviewScroll);
    return () => {
      scroller.removeEventListener("scroll", onEditorScroll);
      preview.removeEventListener("scroll", onPreviewScroll);
    };
  }, [mode]);

  // Navegación de wikilinks/tags y apertura de diagramas desde el preview
  const onPreviewClick = useCallback(
    (event: React.MouseEvent) => {
      // Toggle de checkbox de lista de tareas (lectura/dividido): alterna el
      // marcador [ ]/[x] en el doc; el preview se re-renderiza y se autoguarda.
      const check = (event.target as HTMLElement).closest<HTMLInputElement>(
        'input[type="checkbox"][data-task]',
      );
      if (check) {
        event.preventDefault();
        toggleTaskInDoc(viewRef.current, Number(check.getAttribute("data-task")));
        return;
      }
      const diagram = (event.target as HTMLElement).closest(".mic-excalidraw-block");
      if (diagram) {
        // Clic en el diagrama renderizado → editor Excalidraw (HU-16 CA3)
        setEditingDiag(diagram.getAttribute("data-diag"));
        return;
      }
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#wikilink:")) {
        event.preventDefault();
        openByTitle(decodeURIComponent(href.slice("#wikilink:".length)));
      } else if (href.startsWith("#tag:")) {
        event.preventDefault(); // la vista de tags llega en una versión futura
      }
    },
    [openByTitle],
  );

  // Menú contextual del diagrama: exportar PNG/SVG (HU-17 CA1)
  const onPreviewContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const diagram = (event.target as HTMLElement).closest(".mic-excalidraw-block");
      if (!diagram) return;
      event.preventDefault();
      const diagId = diagram.getAttribute("data-diag");
      if (!diagId) return;
      setDiagMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: "Exportar como PNG",
            onClick: () => void exportDiagram(notaId, diagId, "png"),
          },
          {
            label: "Exportar como SVG",
            onClick: () => void exportDiagram(notaId, diagId, "svg"),
          },
        ],
      });
    },
    [notaId],
  );

  function resolveConflict(apply: boolean) {
    if (apply && conflict !== null) {
      applyContent(conflict);
      remoteUpdatedAtRef.current = conflictUpdatedAtRef.current;
      dirtyRef.current = false;
      saveLocal();
      setSyncState("synced");
    }
    setConflict(null);
    conflictUpdatedAtRef.current = null;
  }

  const notaTitulo = useVaultStore(
    (s) => s.notas.find((n) => n.id === notaId)?.titulo ?? "nota",
  );

  return (
    <div className={styles.editor}>
      <EditorToolbar
        getView={() => viewRef.current}
        mode={mode}
        onModeChange={setMode}
        syncState={syncState}
        onInsertDiagram={insertDiagram}
        notaId={notaId}
        titulo={notaTitulo}
      />

      {isActivePane && <SearchBar getView={() => viewRef.current} />}

      {conflict !== null && (
        <div className={styles.conflictBar}>
          <span>Hay cambios remotos disponibles para esta nota.</span>
          <button type="button" onClick={() => resolveConflict(true)}>
            Aplicar
          </button>
          <button type="button" onClick={() => resolveConflict(false)}>
            Ignorar
          </button>
        </div>
      )}

      <div className={`${styles.content} ${styles[`layout_${mode}`]}`}>
        <div
          ref={hostRef}
          className={`mic-editor-host ${styles.editorPane}`}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            // Drag & drop de archivos .excalidraw sobre el editor (HU-16 CA1b)
            const file = Array.from(e.dataTransfer.files).find((f) =>
              f.name.endsWith(".excalidraw"),
            );
            if (!file) return;
            e.preventDefault();
            void file.text().then(async (text) => {
              const view = viewRef.current;
              if (!view) return;
              const diagId = crypto.randomUUID();
              try {
                await saveDiagram(notaId, diagId, JSON.parse(text));
              } catch {
                return;
              }
              const { from } = view.state.selection.main;
              view.dispatch({
                changes: { from, insert: `![[${diagId}.excalidraw]]` },
              });
            });
          }}
        />
        {(mode === "split" || mode === "read") && (
          <div
            ref={previewRef}
            className={`mic-preview ${mode === "read" ? "mic-layout-read" : ""} ${styles.previewPane}`}
            onClick={onPreviewClick}
            onContextMenu={onPreviewContextMenu}
          >
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>

      {diagMenu && <ContextMenu {...diagMenu} onClose={() => setDiagMenu(null)} />}

      {editingDiag && (
        <ExcalidrawModal
          notaId={notaId}
          diagId={editingDiag}
          onClose={() => {
            setEditingDiag(null);
            setPreviewTick((t) => t + 1); // re-render del SVG embebido
          }}
        />
      )}
    </div>
  );
}
