"use client";

import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { search } from "@codemirror/search";
import { Compartment, EditorState, Transaction, type StateEffect } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { wrapSelection } from "@/lib/editor/commands";
import { startCollab, type CollabHandle } from "@/lib/collab/collab";
import { addCodeCopyButtons } from "@/lib/codeCopy";
import { publishDoc, subscribeDoc } from "@/lib/editor/docBroker";
import { takePendingMatch } from "@/lib/editor/pendingMatch";
import { liveExtensions, refreshAllLiveViews } from "@/lib/editor/livePreview";
import { autoPairs } from "@/lib/editor/autoPairs";
import { docTitleField, setDocTitle } from "@/lib/editor/docTitle";
import { attachHeadingFolds, headingFoldService } from "@/lib/editor/headingFold";
import {
  markMissingWikilinks,
  resolveWikilink,
  wikilinkCompletions,
} from "@/lib/editor/wikilink";
import { registerView, unregisterView } from "@/lib/editor/viewRegistry";
import { extensionesTab } from "@/lib/editor/tabWidth";
import { exportDiagram, renderExcalidrawIn, saveDiagram } from "@/lib/excalidraw";
import {
  olvidarGuardadoPendiente,
  registrarGuardadoPendiente,
} from "@/lib/guardadoPendiente";
import { getCachedNote, putCachedNote } from "@/lib/idb";
import { EVENTO_RECARGA } from "@/lib/vaultWatch";
import { renderNota } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { ContextMenu, type MenuItem } from "@/components/explorer/ContextMenu";
import { ExcalidrawModal } from "./ExcalidrawModal";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSyncStore } from "@/stores/syncStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUiStore } from "@/stores/uiStore";
import { EditorToolbar, type EditorMode, type SyncState } from "./EditorToolbar";
import { NotePanel } from "./NotePanel";
import { SearchBar } from "./SearchBar";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import styles from "./NoteEditor.module.css";

const MODES: EditorMode[] = ["live", "split", "read", "raw"];
const SYNC_INTERVAL_MS = 10_000; // throttle de sync a R2 (HU-04 CA8)
const LOCAL_SAVE_DEBOUNCE_MS = 250; // persistencia en IndexedDB < 500 ms (CA1)
const PREVIEW_DEBOUNCE_MS = 130; // re-render del preview (HU-01 CA3)

/**
 * Cursor y scroll por pestaña mientras está abierta (HU-25 CA10).
 *
 * `scroll` NO es un `scrollTop` en píxeles (DEF-039): es el efecto de
 * `EditorView.scrollSnapshot()`, que ancla la posición a un punto del
 * DOCUMENTO. Es lo único fiable acá, por dos motivos:
 *
 * 1. Se captura mientras el usuario hace scroll, no al desmontar. React 18+
 *    ejecuta la limpieza de un `useEffect` DESPUÉS de sacar el nodo del DOM, y
 *    `scrollTop` de un elemento sin caja devuelve **0** (CSSOM): lo que se
 *    guardaba al volver era siempre el principio del documento.
 * 2. Al restaurar, CodeMirror reaplica el objetivo tras cada medición hasta que
 *    el height-map se estabiliza. Asignar `scrollTop` a mano no puede funcionar:
 *    al crear la vista solo está medido el viewport.
 */
const instanceCache = new Map<
  string,
  {
    doc: string;
    anchor: number;
    head: number;
    scroll: StateEffect<unknown> | null;
    /** Scroll del panel de lectura/dividido, que NO es el scroller de CodeMirror. */
    previewScrollTop: number;
  }
>();

/**
 * Traspaso de la posición de lectura entre modos (`DEF-055`), **por línea**.
 *
 * Cada modo tiene su propio scroller y miden alturas distintas del mismo texto,
 * así que no se puede pasar un `scrollTop` ni una proporción: una tabla de diez
 * filas ocupa diez líneas en markdown y una caja compacta renderizada, y el
 * error de una regla de tres crece justo en el medio del documento.
 *
 * La moneda común es la **línea del documento**. El editor la conoce por
 * definición; el panel de lectura, porque su HTML sale marcado con
 * `data-linea` en cada bloque de primer nivel (ver `renderNota`). Así
 * «estabas en la 214» se resuelve buscando la 214, no estimándola.
 */
function lineaVisibleDelEditor(view: EditorView): number {
  const sc = view.scrollDOM;
  const origen = view.documentTop - sc.getBoundingClientRect().top + sc.scrollTop;
  const bloque = view.lineBlockAtHeight(sc.scrollTop - origen);
  return view.state.doc.lineAt(bloque.from).number;
}

function llevarEditorALinea(view: EditorView, linea: number): void {
  const doc = view.state.doc;
  const n = Math.min(Math.max(1, linea), doc.lines);
  const sc = view.scrollDOM;
  const origen = view.documentTop - sc.getBoundingClientRect().top + sc.scrollTop;
  const y = origen + view.lineBlockAt(doc.line(n).from).top;
  sc.scrollTop = Math.max(0, Math.min(y, sc.scrollHeight - sc.clientHeight));
}

/** Bloques del panel de lectura que llevan su línea de origen, en orden. */
function bloquesConLinea(panel: HTMLElement): { el: HTMLElement; linea: number }[] {
  return Array.from(panel.querySelectorAll<HTMLElement>("[data-linea]")).map((el) => ({
    el,
    linea: Number(el.dataset.linea),
  }));
}

function lineaVisibleDelPreview(panel: HTMLElement): number {
  const arriba = panel.getBoundingClientRect().top;
  let linea = 1;
  for (const b of bloquesConLinea(panel)) {
    // El último bloque que empieza en o por encima del borde: el que se está
    // leyendo. Los siguientes ya están más abajo, así que se corta.
    if (b.el.getBoundingClientRect().top - arriba <= 1) linea = b.linea;
    else break;
  }
  return linea;
}

function llevarPreviewALinea(panel: HTMLElement, linea: number): void {
  let destino: HTMLElement | null = null;
  for (const b of bloquesConLinea(panel)) {
    if (b.linea <= linea) destino = b.el;
    else break;
  }
  if (destino === null) {
    panel.scrollTop = 0;
    return;
  }
  const y = panel.scrollTop + (destino.getBoundingClientRect().top - panel.getBoundingClientRect().top);
  panel.scrollTop = Math.max(0, Math.min(y, panel.scrollHeight - panel.clientHeight));
}

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
    // DEF-056: el comentario decía "centra" pero `scrollIntoView: true` usa la
    // estrategia "nearest", que pega la coincidencia al borde superior. Acá se
    // centra de verdad, igual que en la barra de búsqueda.
    effects: EditorView.scrollIntoView(idx, { y: "center" }),
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
  // Ancho de tabulación (FUN-S-02): en compartimento propio para poder
  // reconfigurarlo al vuelo, sin recrear la vista ni perder cursor y scroll.
  const tabCompartment = useRef(new Compartment());
  const collabRef = useRef<CollabHandle | null>(null);
  const brokerApplyRef = useRef(false);
  // DEF-039: posición de scroll capturada EN VIVO (ver `instanceCache`).
  const scrollSnapshotRef = useRef<StateEffect<unknown> | null>(null);
  const previewScrollRef = useRef(0);
  /** Scroll del preview pendiente de restaurar (null = nada que restaurar). */
  const previewScrollPendienteRef = useRef<number | null>(null);
  // DEF-055: línea pendiente de aplicar tras un cambio de modo. Va aparte del
  // pendiente en píxeles de arriba, que es el de volver a una pestaña (DEF-039):
  // aquel restaura una posición exacta ya conocida, este traduce entre dos
  // vistas del mismo documento.
  const previewLineaPendienteRef = useRef<number | null>(null);
  const editorLineaPendienteRef = useRef<number | null>(null);
  const soltarScrollRef = useRef<(() => void) | null>(null);

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
  // Archivo .excalidraw del vault que se edita en el modal embebido (HU-16).
  const [editingFile, setEditingFile] = useState<string | null>(null);
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
        router.replace(`/workspace?note=${target.id}`);
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
        `/notas/${encodeURIComponent(notaId)}/contenido`,
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
          setPreviewHtml(renderNota(contentRef.current, true));
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

      // Estado guardado de ESTA pestaña (HU-25 CA10 / DEF-039). Solo se
      // restaura si el documento es el mismo que se guardó: si cambió en disco
      // desde fuera, una posición vieja apuntaría a cualquier lado y es
      // preferible arrancar del principio.
      const cached = instanceCache.get(instanceId);
      const restaurable = cached !== undefined && cached.doc === content;

      viewRef.current = new EditorView({
        parent: hostRef.current,
        // El scroll se restaura con el mecanismo propio de CodeMirror: sabe
        // reaplicar el objetivo mientras el height-map se va midiendo.
        scrollTo: restaurable ? cached.scroll ?? undefined : undefined,
        state: EditorState.create({
          doc: content,
          selection: restaurable
            ? {
                anchor: Math.min(cached.anchor, content.length),
                head: Math.min(cached.head, content.length),
              }
            : undefined,
          extensions: [
            // DIAGNÓSTICO TEMPORAL (DEF-031) — quitar al identificar la causa.
            // El clic funciona; lo que falla es MOVERSE. Así que se mide en el
            // cambio de selección: tras dejar que CodeMirror haga su
            // desplazamiento, ¿el cursor quedó dentro de lo visible?
            //   visible=NO  → el editor no lo siguió, o se pasó de largo
            //   fuera=<px>  → cuánto quedó por encima (negativo) o por debajo
            EditorView.updateListener.of((actualizacion) => {
              if (!actualizacion.selectionSet) return;
              const vista = actualizacion.view;
              requestAnimationFrame(() => {
                const cabeza = vista.state.selection.main.head;
                const c = vista.coordsAtPos(cabeza);
                const caja = vista.scrollDOM.getBoundingClientRect();
                if (!c) return;
                const porArriba = Math.round(c.top - caja.top);
                const porAbajo = Math.round(c.bottom - caja.bottom);
                const visible = porArriba >= 0 && porAbajo <= 0;
                console.log(
                  `[DEF-031] visible=${visible ? "si" : "NO"}` +
                    ` fuera=${porArriba < 0 ? porArriba : porAbajo > 0 ? porAbajo : 0}` +
                    ` | cursorY=[${Math.round(c.top)},${Math.round(c.bottom)}]` +
                    ` viewport=[${Math.round(caja.top)},${Math.round(caja.bottom)}]` +
                    ` | nLinea=${vista.state.doc.lineAt(cabeza).number}/${vista.state.doc.lines}` +
                    ` scrollTop=${Math.round(vista.scrollDOM.scrollTop)}` +
                    ` | userEvent=${actualizacion.transactions.map((t) => t.annotation(Transaction.userEvent) ?? "-").join(",")}`,
                );
              });
            }),
            history(),
            // Tab/Shift+Tab indentan la línea (sangría) en vez de mover el foco.
            keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
            formatKeymap,
            // Autocierre de pares ()[]{}""''``** __ con envoltura de la selección;
            // se consulta la preferencia en cada pulsación (toggle en vivo).
            autoPairs(() => usePreferencesStore.getState().prefs.autoCloseBrackets),
            // Panel propio: la UI real es SearchBar (HU-31); el panel nativo
            // se reemplaza por un nodo vacío para activar el resaltado.
            search({ createPanel: () => ({ dom: document.createElement("div") }) }),
            markdown({ extensions: GFM, codeLanguages: languages }),
            // Autocompletado de wikilinks al escribir dentro de `[[` (estilo
            // Obsidian); inserta la ruta de carpeta si el nombre es ambiguo.
            autocompletion({ override: [wikilinkCompletions] }),
            // Plegar secciones por título (raw + edición en vivo): flecha en el
            // gutter sobre cada título; pliega hasta el próximo título <= nivel.
            codeFolding(),
            foldGutter({ openText: "⌄", closedText: "›" }),
            headingFoldService,
            // Título (nombre del archivo) como bloque al inicio del documento.
            docTitleField,
            EditorView.lineWrapping,
            placeholder("Escribí tu nota…"),
            liveCompartment.current.of(
              modeRef.current === "live" ? liveExtensions(openByTitle, noteExists, notaId) : [],
            ),
            // Colaboración en vivo (HU-05/06/37); vacío salvo en notas
            // compartidas con relay disponible (cloudflare).
            collabCompartment.current.of([]),
            tabCompartment.current.of(
              extensionesTab(usePreferencesStore.getState().prefs.tabWidth),
            ),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              const doc = update.state.doc.toString();
              if (brokerApplyRef.current) {
                // Cambio venido de otra instancia de la misma nota
                contentRef.current = doc;
                if (modeRef.current === "split" || modeRef.current === "read") {
                  setPreviewHtml(renderNota(doc, true));
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

      // Título inicial dentro del documento (se lee del store para evitar
      // closures obsoletos; los cambios posteriores los aplica un efecto).
      {
        const titulo =
          useVaultStore.getState().notas.find((n) => n.id === notaId)?.titulo ?? "nota";
        const show = usePreferencesStore.getState().prefs.showFileTitle;
        viewRef.current.dispatch({ effects: setDocTitle.of({ title: titulo, show }) });
      }

      // Intentar colaboración en tiempo real (inerte en local; HU-05/06/37)
      if (!collabRef.current) {
        void startCollab(notaId, viewRef.current, collabCompartment.current, content).then(
          (handle) => {
            collabRef.current = handle;
          },
        );
      }

      // El cursor y el `scrollTo` ya viajaron en la creación de la vista; queda
      // sembrar los refs para no perder la posición si el usuario vuelve a
      // cambiar de pestaña sin haber hecho scroll (DEF-039).
      if (restaurable) {
        scrollSnapshotRef.current = cached.scroll;
        previewScrollRef.current = cached.previewScrollTop;
        previewScrollPendienteRef.current =
          cached.previewScrollTop > 0 ? cached.previewScrollTop : null;
      }

      // Capturar la posición MIENTRAS se hace scroll: al desmontar ya no se
      // puede leer del DOM (React lo desmonta antes de ejecutar la limpieza del
      // efecto y `scrollTop` de un nodo desprendido vale 0).
      {
        const scroller = viewRef.current.scrollDOM;
        let pedido = 0;
        const onScroll = () => {
          if (pedido) return;
          pedido = requestAnimationFrame(() => {
            pedido = 0;
            const view = viewRef.current;
            if (view) scrollSnapshotRef.current = view.scrollSnapshot();
          });
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        soltarScrollRef.current = () => {
          if (pedido) cancelAnimationFrame(pedido);
          scroller.removeEventListener("scroll", onScroll);
        };
      }

      setPreviewHtml(renderNota(content, true));

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

  // ── Recarga por cambio EXTERNO del archivo (modo carpeta, fase 5) ──
  //
  // El watcher del vault detectó que algo cambió en disco y `vaultWatch` ya
  // reindexó; aquí releemos el contenido de ESTA nota desde el índice (que
  // refleja el disco) y lo aplicamos, pero SOLO si el editor no tiene cambios
  // locales sin guardar: no se pisan ediciones en curso. Si los hay, se deja la
  // versión local intacta (un aviso de conflicto explícito queda para más
  // adelante). Cada instancia abierta de la nota se recarga sola.
  const reloadFromDisk = useCallback(async () => {
    if (dirtyRef.current || !viewRef.current) return;
    try {
      const remote = await api<{ contenido: string; actualizadoEn: string }>(
        `/notas/${encodeURIComponent(notaId)}/contenido`,
        { token: useAuthStore.getState().accessToken },
      );
      // Re-chequear tras el await: el usuario pudo empezar a editar mientras tanto.
      if (dirtyRef.current || !viewRef.current) return;
      if (remote.actualizadoEn === remoteUpdatedAtRef.current) return; // sin cambios
      if (remote.contenido === contentRef.current) {
        remoteUpdatedAtRef.current = remote.actualizadoEn;
        saveLocal();
        return;
      }
      // Aplicar como cambio "remoto" (brokerApplyRef evita marcar la nota sucia).
      brokerApplyRef.current = true;
      applyContent(remote.contenido);
      brokerApplyRef.current = false;
      contentRef.current = remote.contenido;
      dirtyRef.current = false;
      remoteUpdatedAtRef.current = remote.actualizadoEn;
      saveLocal();
      setSyncState("synced");
      // El cambio vino de disco, así que el updateListener no publicó nada: se
      // avisa a mano para que los suscriptores (el panel de propiedades, otras
      // instancias de la nota) no se queden con el texto viejo.
      publishDoc(notaId, instanceId, remote.contenido);
    } catch {
      // Best-effort: si falla la relectura, no se toca lo que hay en pantalla.
    }
  }, [notaId, instanceId, applyContent, saveLocal, setSyncState]);

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
          `/notas/${encodeURIComponent(notaId)}/contenido`,
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
      soltarScrollRef.current?.();
      soltarScrollRef.current = null;
      const view = viewRef.current;
      if (view) {
        // Cursor/scroll de la pestaña para restaurar al volver (HU-25 CA10).
        // OJO (DEF-039): acá NO se puede leer el scroll del DOM — React ya
        // desmontó el nodo y `scrollTop` valdría 0. Se usa lo capturado en vivo.
        const { anchor, head } = view.state.selection.main;
        instanceCache.set(instanceId, {
          doc: contentRef.current,
          anchor,
          head,
          scroll: scrollSnapshotRef.current,
          previewScrollTop: previewScrollRef.current,
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

  // Recarga ante cambios externos del vault (modo carpeta, fase 5). El evento lo
  // dispara `vaultWatch` tras reindexar; `reloadFromDisk` respeta los cambios
  // locales sin guardar.
  useEffect(() => {
    function onRecarga() {
      void reloadFromDisk();
    }
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    return () => window.removeEventListener(EVENTO_RECARGA, onRecarga);
  }, [reloadFromDisk]);

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

  // Actualizar cierra la app (FUN-L-14): el updater fuerza acá el guardado
  // pendiente y ESPERA a que termine antes de lanzar el instalador. Sin esto,
  // lo escrito entre la última tecla y el debounce se perdería al reiniciar.
  useEffect(() => {
    registrarGuardadoPendiente(`nota:${instanceId}`, syncNow);
    return () => olvidarGuardadoPendiente(`nota:${instanceId}`);
  }, [instanceId, syncNow]);

  useEffect(() => {
    const interval = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const onOnline = () => void syncNow();
    const onBeforeUnload = () => {
      // Guardado best-effort al cerrar: en el escritorio va a SQLite vía el
      // dispatcher local (antes era un fetch al backend .NET).
      if (dirtyRef.current) {
        void api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
          method: "PUT",
          body: { contenido: contentRef.current },
        });
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
      // DEF-055: cada modo tiene SU scroller —CodeMirror en edición, el panel en
      // lectura—, así que al cambiar hay que traspasar la posición de uno a otro
      // o el documento aparece en el principio. Se lee ANTES de cambiar, mientras
      // el que sale todavía está visible: un elemento con `display: none` informa
      // `scrollTop` 0.
      const anterior = modeRef.current;
      if (next !== anterior) {
        const linea =
          anterior === "read"
            ? previewRef.current
              ? lineaVisibleDelPreview(previewRef.current)
              : null
            : viewRef.current
              ? lineaVisibleDelEditor(viewRef.current)
              : null;
        if (linea !== null) {
          if (next === "read" || next === "split") previewLineaPendienteRef.current = linea;
          else editorLineaPendienteRef.current = linea;
        }
      }
      setModeState(next);
      modeRef.current = next;
      window.localStorage.setItem(`micelio-mode-${notaId}`, next);
      viewRef.current?.dispatch({
        effects: liveCompartment.current.reconfigure(
          next === "live" ? liveExtensions(openByTitle, noteExists, notaId) : [],
        ),
      });
      if (next === "split" || next === "read") {
        setPreviewHtml(renderNota(contentRef.current, true));
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

  // Datos del vault para resolver wikilinks/embeds del preview. Reacciona a
  // cambios del vault (crear/renombrar/borrar/mover) via suscripción.
  const vaultNotas = useVaultStore((s) => s.notas);
  const vaultCarpetas = useVaultStore((s) => s.carpetas);

  // Diagramas Mermaid (HU-18) y Excalidraw (HU-16) en el preview
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      void renderMermaidIn(previewRef.current);
      void renderExcalidrawIn(previewRef.current, notaId);
      addCodeCopyButtons(previewRef.current); // botón copiar en bloques de código
    }
  }, [previewHtml, mode, previewTick, notaId, vaultNotas, vaultCarpetas]);

  // Las flechas de plegado se inyectan en el DOM DESPUÉS de que React pinte, así
  // que cualquier re-render que reescriba el HTML del preview se las lleva —
  // aunque el contenido no haya cambiado. Pasaba al tocar una preferencia
  // (`DEF-050`): el editor se re-renderizaba, las flechas desaparecían, y el
  // efecto de arriba no volvía a correr porque sus dependencias seguían iguales.
  //
  // Por eso este va **sin lista de dependencias**: se ejecuta tras cada render y
  // repone lo que falte. `attachHeadingFolds` es idempotente y conserva qué había
  // plegado, así que repetirlo no cuesta ni pierde estado.
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      attachHeadingFolds(previewRef.current);
    }
  });

  // Feedback de inexistencia: oscurece los wikilinks a archivos que no existen.
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      markMissingWikilinks(previewRef.current, vaultNotas, vaultCarpetas);
    }
  }, [previewHtml, mode, previewTick, vaultNotas, vaultCarpetas]);

  /**
   * Crea un archivo .excalidraw REAL en la carpeta de la nota actual (aparece en
   * el explorador y es manipulable como cualquier nota), inserta su embed por
   * título y abre el panel de edición embebido (modal) para dibujar enseguida,
   * sin salir del markdown (HU-16 CA1a).
   */
  const insertDiagram = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const vault = useVaultStore.getState();
    const carpetaId = vault.notas.find((n) => n.id === notaId)?.carpetaId ?? null;
    void vault.createNota(carpetaId, "excalidraw").then((newId) => {
      const titulo =
        useVaultStore.getState().notas.find((n) => n.id === newId)?.titulo ??
        "Dibujo sin título";
      const { from } = view.state.selection.main;
      view.dispatch({ changes: { from, insert: `![[${titulo}.excalidraw]]` } });
      setEditingFile(newId); // abrir el editor embebido del nuevo dibujo
    });
  }, [notaId]);

  // DEF-039 CA2: en modo lectura (y en dividido) el scroller VISIBLE no es el de
  // CodeMirror sino el del preview, así que hay que seguirlo aparte. Mientras
  // haya una restauración pendiente no se registra: los reintentos de abajo
  // producen valores intermedios recortados.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const onScroll = () => {
      if (previewScrollPendienteRef.current !== null) return;
      if (previewLineaPendienteRef.current !== null) return;
      previewScrollRef.current = preview.scrollTop;
    };
    preview.addEventListener("scroll", onScroll, { passive: true });
    return () => preview.removeEventListener("scroll", onScroll);
  }, [mode]);

  // DEF-039 CA2: restaurar el scroll del preview. Se reintenta por frames porque
  // el alto real llega tarde (Mermaid, Excalidraw e imágenes se renderizan
  // después), y hasta entonces el navegador recorta la asignación.
  useEffect(() => {
    if (previewScrollPendienteRef.current === null) return;
    if (mode !== "read" && mode !== "split") return;
    let raf = 0;
    let intentos = 0;
    const aplicar = () => {
      const preview = previewRef.current;
      const objetivo = previewScrollPendienteRef.current;
      if (!preview || objetivo === null) return;
      preview.scrollTop = objetivo;
      if (Math.abs(preview.scrollTop - objetivo) > 1 && intentos++ < 30) {
        raf = requestAnimationFrame(aplicar);
      } else {
        previewScrollRef.current = preview.scrollTop;
        previewScrollPendienteRef.current = null;
      }
    };
    raf = requestAnimationFrame(aplicar);
    return () => cancelAnimationFrame(raf);
  }, [previewHtml, mode, previewTick]);

  // DEF-055: aplicar al panel de lectura el ratio traído del otro modo. Se
  // reintenta mientras el alto siga cambiando (Mermaid, Excalidraw e imágenes
  // llegan tarde) y se corta en cuanto se estabiliza, para no pelear con el
  // usuario si vuelve a desplazar. Cede ante el pendiente en píxeles de DEF-039,
  // que es una posición exacta y por tanto mejor.
  useEffect(() => {
    if (previewLineaPendienteRef.current === null) return;
    if (previewScrollPendienteRef.current !== null) return;
    if (mode !== "read" && mode !== "split") return;
    let raf = 0;
    let intentos = 0;
    let altoPrevio = -1;
    const aplicar = () => {
      const preview = previewRef.current;
      const linea = previewLineaPendienteRef.current;
      if (!preview || linea === null) return;
      if (preview.scrollHeight !== altoPrevio && intentos++ < 30) {
        altoPrevio = preview.scrollHeight;
        llevarPreviewALinea(preview, linea);
        raf = requestAnimationFrame(aplicar);
      } else {
        previewScrollRef.current = preview.scrollTop;
        previewLineaPendienteRef.current = null;
      }
    };
    raf = requestAnimationFrame(aplicar);
    return () => cancelAnimationFrame(raf);
  }, [previewHtml, mode, previewTick]);

  // DEF-055: lo mismo al volver a un modo de edición. Acá sí se asigna
  // `scrollTop` a mano —lo que DEF-039 desaconseja al CREAR la vista— porque el
  // editor no se desmonta nunca: en lectura solo queda oculto, así que ya está
  // medido y solo hay que reposicionarlo.
  useEffect(() => {
    if (editorLineaPendienteRef.current === null) return;
    if (mode !== "live" && mode !== "raw") return;
    const scroller = viewRef.current?.scrollDOM;
    if (!scroller) return;
    let raf = 0;
    let intentos = 0;
    let altoPrevio = -1;
    const aplicar = () => {
      const linea = editorLineaPendienteRef.current;
      if (linea === null) return;
      const vista = viewRef.current;
      if (!vista) return;
      if (scroller.scrollHeight !== altoPrevio && intentos++ < 30) {
        altoPrevio = scroller.scrollHeight;
        llevarEditorALinea(vista, linea);
        raf = requestAnimationFrame(aplicar);
      } else {
        editorLineaPendienteRef.current = null;
      }
    };
    raf = requestAnimationFrame(aplicar);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

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
        const targetNota = diagram.getAttribute("data-nota");
        if (targetNota) {
          // Archivo .excalidraw del vault → editarlo en el modal embebido, sin
          // salir del markdown (HU-16 CA3).
          setEditingFile(targetNota);
        } else {
          // Diagrama embebido (legado) → editor Excalidraw en modal.
          setEditingDiag(diagram.getAttribute("data-diag"));
        }
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
    [openByTitle, router],
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

  const showFileTitle = usePreferencesStore((s) => s.prefs.showFileTitle);
  const tabWidth = usePreferencesStore((s) => s.prefs.tabWidth);
  // Panel de metadatos embebido a la derecha de ESTE editor (toggle global).
  const metaPanelOpen = usePanelLayoutStore((s) => s.rightOpen);

  // Cambiar el ancho de tabulación se aplica a los editores ya abiertos
  // (FUN-S-02): reconfigurar el compartimento, no recrear la vista.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabCompartment.current.reconfigure(extensionesTab(tabWidth)),
    });
  }, [tabWidth]);

  // Mantener el título del bloque del editor al renombrar o togglear la opción.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setDocTitle.of({ title: notaTitulo, show: showFileTitle }),
    });
  }, [notaTitulo, showFileTitle]);

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

      {isActivePane && (
        <SearchBar
          getView={() => viewRef.current}
          getPreview={() => previewRef.current}
          modoLectura={mode === "read"}
        />
      )}

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

      <div className={styles.body}>
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
            {/* Título dentro del documento, al inicio (se desplaza con el
                contenido); tipografía del preview. */}
            {showFileTitle && (
              <div className="mic-doc-title mic-doc-title-preview">{notaTitulo}</div>
            )}
            <div className="mic-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>
        {metaPanelOpen && <NotePanel notaId={notaId} paneId={paneId} />}
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

      {editingFile && (
        <ExcalidrawModal
          fileId={editingFile}
          onClose={() => {
            setEditingFile(null);
            setPreviewTick((t) => t + 1); // re-render del SVG en lectura/dividido
            refreshAllLiveViews(); // re-render del embed en vivo
          }}
        />
      )}
    </div>
  );
}
