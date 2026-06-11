"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { wrapSelection } from "@/lib/editor/commands";
import { liveExtensions } from "@/lib/editor/livePreview";
import { getCachedNote, putCachedNote } from "@/lib/idb";
import { renderMarkdown } from "@/lib/markdown";
import { useAuthStore } from "@/stores/authStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUiStore } from "@/stores/uiStore";
import { EditorToolbar, type EditorMode, type SyncState } from "./EditorToolbar";
import { SearchBar } from "./SearchBar";
import styles from "./NoteEditor.module.css";

const MODES: EditorMode[] = ["live", "split", "read", "raw"];
const SYNC_INTERVAL_MS = 10_000; // throttle de sync a R2 (HU-04 CA8)
const LOCAL_SAVE_DEBOUNCE_MS = 250; // persistencia en IndexedDB < 500 ms (CA1)
const PREVIEW_DEBOUNCE_MS = 130; // re-render del preview (HU-01 CA3)

/**
 * Editor de una nota (HU-01/02/04/19): CodeMirror 6 con live preview por
 * línea, modos live/split/read/raw, autoguardado en IndexedDB y sync
 * throttled con el backend.
 */
export function NoteEditor({ notaId }: { notaId: string }) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveCompartment = useRef(new Compartment());

  const [mode, setModeState] = useState<EditorMode>(() => {
    if (typeof window === "undefined") return "live";
    const saved = window.localStorage.getItem(`micelio-mode-${notaId}`);
    return MODES.includes(saved as EditorMode) ? (saved as EditorMode) : "live";
  });
  const [syncState, setSyncState] = useState<SyncState>("local");
  const [previewHtml, setPreviewHtml] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);

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
      const target = useVaultStore
        .getState()
        .notas.find((n) => n.titulo.toLowerCase() === title.toLowerCase());
      if (target) router.push(`/workspace?note=${target.id}`);
    },
    [router],
  );

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
            keymap.of([...defaultKeymap, ...historyKeymap]),
            formatKeymap,
            // Panel propio: la UI real es SearchBar (HU-31); el panel nativo
            // se reemplaza por un nodo vacío para activar el resaltado.
            search({ createPanel: () => ({ dom: document.createElement("div") }) }),
            markdown(),
            EditorView.lineWrapping,
            placeholder("Escribí tu nota…"),
            liveCompartment.current.of(
              modeRef.current === "live" ? liveExtensions(openByTitle) : [],
            ),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) onDocChanged(update.state.doc.toString());
            }),
          ],
        }),
      });

      setPreviewHtml(renderMarkdown(content));
    },
    [onDocChanged, openByTitle],
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

      if (cached) {
        dirtyRef.current = cached.dirty;
        remoteUpdatedAtRef.current = cached.remoteUpdatedAt;
        createView(cached.content);
        setSyncState(cached.dirty ? "local" : "synced");
      }

      try {
        const remote = await api<{ contenido: string; actualizadoEn: string }>(
          `/notas/${notaId}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        if (cancelled) return;

        if (!cached) {
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
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaId]);

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
          next === "live" ? liveExtensions(openByTitle) : [],
        ),
      });
      if (next === "split" || next === "read") {
        setPreviewHtml(renderMarkdown(contentRef.current));
      }
    },
    [notaId, openByTitle],
  );

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
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
  }, [setMode]);

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

  // Navegación de wikilinks y tags desde el preview renderizado
  const onPreviewClick = useCallback(
    (event: React.MouseEvent) => {
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

  return (
    <div className={styles.editor}>
      <EditorToolbar
        getView={() => viewRef.current}
        mode={mode}
        onModeChange={setMode}
        syncState={syncState}
      />

      <SearchBar getView={() => viewRef.current} />

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
        <div ref={hostRef} className={`mic-editor-host ${styles.editorPane}`} />
        {(mode === "split" || mode === "read") && (
          <div
            ref={previewRef}
            className={`mic-preview ${mode === "read" ? "mic-layout-read" : ""} ${styles.previewPane}`}
            onClick={onPreviewClick}
          >
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>
    </div>
  );
}
