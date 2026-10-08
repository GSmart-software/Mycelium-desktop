"use client";

import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  codeFolding,
  foldEffect,
  foldGutter,
  foldKeymap,
  foldedRanges,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type StateEffect } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { confirmar } from "@/lib/confirmar";
import {
  decidirAnteCambioExterno,
  rutaDeCopiaDeEmergencia,
  tituloDeCopiaLocal,
} from "@/lib/conflictoExterno";
import { olvidarConflicto, registrarConflicto } from "@/lib/conflictosAbiertos";
import { escribirNota } from "@/lib/db/vaultFs";
import { getVaultActual } from "@/lib/db/vaultContext";
import { avisoTocaA } from "@/lib/recargaExterna";
import { wrapSelection } from "@/lib/editor/commands";
import { addCodeCopyButtons } from "@/lib/codeCopy";
import { TITULO_POR_DEFECTO } from "@/lib/extensionesDeTipo";
import { publishDoc, subscribeDoc } from "@/lib/editor/docBroker";
import {
  pedirSaltoAAncla,
  setPendingMatch,
  takePendingMatch,
  type Salto,
} from "@/lib/editor/pendingMatch";
import {
  carpetaDeLaNota,
  liveExtensions,
  refreshAllLiveViews,
} from "@/lib/editor/livePreview";
import { carpetaDeNota, rellenarImagenesEn } from "@/lib/imagenesRender";
import { autoPairs } from "@/lib/editor/autoPairs";
import {
  type DestinoTrasTitulo,
  docTitleField,
  editarTitulo,
  enfocarTrasTitulo,
  renombrarPorTitulo,
  salirDelTitulo,
  setDocTitle,
} from "@/lib/editor/docTitle";
import { tomarEdicionDeTitulo } from "@/lib/editor/tituloPendiente";
import { attachHeadingFolds, headingFoldService } from "@/lib/editor/headingFold";
import { markMissingWikilinks, wikilinkCompletions } from "@/lib/editor/wikilink";
import { registerView, unregisterView } from "@/lib/editor/viewRegistry";
import { extensionesTab } from "@/lib/editor/tabWidth";
import { renderDrawioIn } from "@/lib/drawioRender";
import { manejarClicDeEnlace } from "@/lib/enlacesExternos";
import { exportDiagram, renderExcalidrawIn } from "@/lib/excalidraw";
import {
  olvidarGuardadoPendiente,
  registrarGuardadoPendiente,
} from "@/lib/guardadoPendiente";
import { EVENTO_RECARGA } from "@/lib/vaultWatch";
import {
  esAnclaPropia,
  etiquetaDeReferencia,
  lineaDeAncla,
  refUnivoca,
  resolverReferencia,
} from "@/lib/wikilinks";
import { avisar, avisarFallo } from "@/stores/avisosStore";
import { EVENTO_NOTA_GUARDADA } from "@/lib/eventos";
import { renderNota } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { ContextMenu, type MenuItem } from "@/components/explorer/ContextMenu";
import { itemsEstadosTarea } from "@/components/editor/MenuEstadosTarea";
import { simboloAlClic } from "@/lib/estadosTarea";
import { GFM_MYCELIUM, cambiarSimboloTarea } from "@/lib/editor/tareas";
import { ExcalidrawModal } from "./ExcalidrawModal";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { contarPalabras, useSyncStore } from "@/stores/syncStore";
import { panelMetaAbierto, useTabsStore } from "@/stores/tabsStore";
import { usePrefVault } from "@/stores/prefsVaultStore";
import { numerosDeLineaExt } from "@/lib/editor/numerosDeLinea";
import { correctorOrtografico } from "@/lib/editor/ortografia";
import { useVaultStore } from "@/stores/vaultStore";
import { useUiStore } from "@/stores/uiStore";
import { EditorToolbar, type EditorMode, type SyncState } from "./EditorToolbar";
import { NotePanel } from "./NotePanel";
import { SearchBar } from "./SearchBar";
import styles from "./NoteEditor.module.css";

const MODES: EditorMode[] = ["live", "split", "read", "raw"];
const SYNC_INTERVAL_MS = 10_000; // guardado periódico al disco (HU-04 CA8)
const PREVIEW_DEBOUNCE_MS = 130; // re-render del preview (HU-01 CA3)
const PALABRAS_DEBOUNCE_MS = 400; // conteo de palabras de la barra de estado

/** Textos que CodeMirror genera por su cuenta —tooltips, anuncios para lectores
 *  de pantalla— y que salían en inglés en una interfaz en español. Son todas
 *  las frases de las extensiones que usa este editor (plegado, autocompletado,
 *  vista); las del panel de búsqueda no aparecen porque ese panel es propio. */
const frasesEditor = EditorState.phrases.of({
  "folded code": "sección plegada",
  unfold: "desplegar",
  "Folded lines": "Líneas plegadas",
  "Unfolded lines": "Líneas desplegadas",
  to: "a",
  Completions: "Sugerencias",
  close: "cerrar",
  "Selection deleted": "Selección borrada",
  "Control character": "Carácter de control",
});

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
    /**
     * Secciones plegadas, que también son de la pestaña (`DEF-065`).
     *
     * Van acá y no en un almacén propio del plegado porque acá está la vida que
     * el defecto pide: **sobrevive a cambiar de pestaña y muere al cerrarla**
     * —al reabrir la nota, la pestaña es otra y su `instanceId` también, así que
     * arranca con todo desplegado, como se especificó—.
     *
     * Son dos porque el plegado de cada vista es cosa distinta: en edición son
     * rangos del documento que maneja CodeMirror, y en lectura son títulos del
     * DOM identificados por su texto.
     */
    plegadosEdicion: { from: number; to: number }[];
    plegadosLectura: Set<string>;
    /**
     * Si `doc` tenía cambios sin guardar al salir de la pestaña. Salir los
     * guarda, pero en segundo plano: al volver, si ese guardado todavía no
     * terminó (o falló), `doc` manda sobre el disco; si terminó, lo que haya en
     * disco es lo último —incluido un cambio hecho desde fuera mientras tanto—.
     */
    sucio: boolean;
    /**
     * Lo último que la pestaña sabía que estaba en disco (`ultimoGuardadoRef`):
     * la base contra la que se decide si lo de afuera choca con lo de adentro
     * al volver (`DEF-138`). Si el guardado de al salir termina bien, pasa a ser
     * lo que se guardó.
     */
    conocido: string | null;
    /** La pestaña quedó con un conflicto con el disco sin resolver (`DEF-138`). */
    conflicto: boolean;
    /**
     * El guardado de al salir, mientras viaja. Volver a la pestaña lo espera
     * antes de comparar con el disco: si no, lo que ese guardado escribe se
     * vería como un cambio de afuera.
     */
    guardando: Promise<void> | null;
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

/**
 * La casilla de tarea de la vista de lectura que recibió el evento, con la
 * posición de su marcador en el documento (`data-task-pos`, que pone
 * `lib/markdown.ts`) y su símbolo. Antes se contaban las tareas por orden con
 * una expresión regular sobre el texto, que no veía las de dentro de una cita o
 * un callout (`> - [ ]`) y desfasaba todas las siguientes; con la posición, el
 * marcador es el que el parser encontró, y `cambiarSimboloTarea` comprueba que
 * siga ahí antes de escribir (`FUN-S-01`).
 */
function casillaDeTarea(objetivo: EventTarget): { pos: number; simbolo: string } | null {
  const check = (objetivo as HTMLElement).closest?.<HTMLInputElement>(
    'input[type="checkbox"][data-task-pos]',
  );
  if (!check) return null;
  const pos = Number(check.getAttribute("data-task-pos"));
  if (!Number.isInteger(pos)) return null;
  return { pos, simbolo: check.getAttribute("data-task") ?? " " };
}

/**
 * Selecciona y centra la primera coincidencia de `term` en la vista (HU-21 CA8),
 * o pone el cursor al principio de una línea (`{ linea }`, desde 1: el MCP de
 * control, `FUN-L-09`, que ya resolvió el encabezado o el texto a su línea), o
 * al encabezado o bloque de un `[[Nota#Encabezado]]` (`{ ancla }`, `DEF-141`).
 * Devuelve la línea a la que fue, para que el panel de lectura la siga; `null`
 * si no fue a ningún lado (un ancla que la nota no tiene la deja al principio,
 * como Obsidian).
 */
function gotoMatch(view: EditorView, salto: Salto): number | null {
  if (typeof salto !== "string") {
    const doc = view.state.doc;
    const numero = "ancla" in salto ? lineaDeAncla(doc.toString(), salto.ancla) : salto.linea;
    if (numero === null) return null;
    const linea = doc.line(Math.min(Math.max(1, Math.trunc(numero)), doc.lines));
    view.dispatch({
      selection: { anchor: linea.from },
      // Un encabezado se lee desde arriba: va al borde superior, no al centro.
      effects: EditorView.scrollIntoView(linea.from, { y: "ancla" in salto ? "start" : "center" }),
    });
    view.focus();
    return linea.number;
  }
  const term = salto;
  if (!term) return null;
  const idx = view.state.doc.toString().toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return null;
  view.dispatch({
    selection: { anchor: idx, head: idx + term.length },
    // DEF-056: el comentario decía "centra" pero `scrollIntoView: true` usa la
    // estrategia "nearest", que pega la coincidencia al borde superior. Acá se
    // centra de verdad, igual que en la barra de búsqueda.
    effects: EditorView.scrollIntoView(idx, { y: "center" }),
  });
  view.focus();
  return view.state.doc.lineAt(idx).number;
}

/**
 * Editor de una nota (HU-01/02/04/19): CodeMirror 6 con live preview por
 * línea, modos live/split/read/raw y guardado al disco (periódico, al salir de
 * la nota y al cerrar la app). Multi-instancia: la misma nota en dos panes
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
  // Ancho de tabulación (FUN-S-02): en compartimento propio para poder
  // reconfigurarlo al vuelo, sin recrear la vista ni perder cursor y scroll.
  const tabCompartment = useRef(new Compartment());
  /** Números de línea (`FUN-M-28`): se prende y apaga sin recrear la vista. */
  const numerosCompartment = useRef(new Compartment());
  const brokerApplyRef = useRef(false);
  // DEF-039: posición de scroll capturada EN VIVO (ver `instanceCache`).
  const scrollSnapshotRef = useRef<StateEffect<unknown> | null>(null);
  const previewScrollRef = useRef(0);
  /** Scroll del preview pendiente de restaurar (null = nada que restaurar). */
  const previewScrollPendienteRef = useRef<number | null>(null);
  /**
   * Títulos plegados en la vista de lectura (`DEF-065`/`DEF-075`). El conjunto
   * lo tiene el editor y no el módulo de plegado: así su vida es la de la
   * pestaña, y no la del nodo del DOM —que se reemplaza en cada re-render del
   * preview, y era lo que deshacía el plegado solo—.
   */
  const plegadosLecturaRef = useRef<Set<string>>(new Set());
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
  // El estado de guardado vive en el store: lo muestran la barra de estado y
  // el punto de la pestaña, no la barra del editor.
  const setSyncState = useCallback(
    (state: SyncState) => {
      useSyncStore.getState().setSyncState(notaId, state);
    },
    [notaId],
  );
  const [previewHtml, setPreviewHtml] = useState("");
  // Archivo .excalidraw del vault que se edita en el modal embebido (HU-16).
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [diagMenu, setDiagMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const palabrasTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modeRef = useRef(mode);
  // El id de la nota, por referencia. Renombrar en modo carpeta CAMBIA el id
  // —la identidad es la ruta—, y quien lo necesita vive en la vista de
  // CodeMirror, que se crea una sola vez (`FUN-M-24`).
  const notaIdRef = useRef(notaId);
  notaIdRef.current = notaId;
  /**
   * Foco que quedó pendiente al salir del título (`DEF-139`): renombrar cambia
   * el id, la vista se destruye y se recrea, y si la nueva todavía no existe
   * cuando hay que enfocarla, se la enfoca al crearla.
   */
  const focoTrasTituloRef = useRef<DestinoTrasTitulo | null>(null);
  const contentRef = useRef("");
  const dirtyRef = useRef(false);
  /**
   * Lo último que este editor sabe que está en disco: lo que guardó, o lo que
   * leyó (`DEF-117`). Sirve para reconocer el eco de un guardado propio cuando
   * el watcher dispara la recarga.
   */
  const ultimoGuardadoRef = useRef<string | null>(null);
  /**
   * Conflicto con el disco (`DEF-138`): el archivo cambió fuera de Mycelium y
   * la nota tiene cambios propios. Mientras dure, el guardado automático está
   * en pausa y la nota muestra la barra para elegir. El ref es para los
   * callbacks; el estado, para pintar la barra.
   */
  const conflictoRef = useRef(false);
  const [conflicto, setConflicto] = useState(false);
  const [resolviendo, setResolviendo] = useState(false);
  /** «Guardar lo mío como copia», por referencia: lo usa también el cierre. */
  const guardarCopiaRef = useRef<() => Promise<boolean>>(async () => false);
  /**
   * Guardados que terminaron. Una revisión del disco que se cruzó con un
   * guardado lee una foto que ya no vale —ni la de antes ni la de después—, y
   * compararla daría un conflicto que no existe: se descarta.
   */
  const guardadosRef = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cuánto tardó el último render del preview, para el debounce adaptativo.
  const ultimoRenderMs = useRef(0);
  const syncingRef = useRef(false);

  /**
   * Lleva la vista a una línea y, en lectura o dividido, también el panel de
   * lectura, que tiene su propio scroll (`DEF-141`). Se reusa el pendiente por
   * línea de `DEF-055`; el de píxeles de `DEF-039` —volver a la pestaña donde
   * estaba— cede, porque se pidió ir a otro lado.
   */
  const saltar = useCallback((view: EditorView, salto: Salto): number | null => {
    const linea = gotoMatch(view, salto);
    if (linea === null) return null;
    if (modeRef.current === "read" || modeRef.current === "split") {
      previewLineaPendienteRef.current = linea;
      previewScrollPendienteRef.current = null;
      setPreviewTick((t) => t + 1);
    }
    return linea;
  }, []);

  const openByTitle = useCallback(
    (title: string) => {
      // `[[#Encabezado]]`: un salto dentro de esta misma nota (`DEF-141`).
      if (esAnclaPropia(title)) {
        if (viewRef.current) saltar(viewRef.current, { ancla: title.trim().slice(1) });
        return;
      }
      const { notas, carpetas } = useVaultStore.getState();
      // Acepta `título` o `Carpeta/título` para desambiguar homónimos, y el
      // ancla (`Nota#Encabezado`) no participa en encontrar la nota (`DEF-141`).
      const { nota: target, ancla } = resolverReferencia(title, notas, carpetas);
      if (!target) return;
      if (target.id === notaIdRef.current && ancla) {
        if (viewRef.current) saltar(viewRef.current, { ancla });
        return;
      }
      useTabsStore.getState().openNote(target.id);
      router.replace(`/workspace?note=${target.id}`);
      if (ancla) pedirSaltoAAncla(target.id, ancla);
    },
    [router, saltar],
  );

  // ¿Existe el archivo referenciado por un wikilink? (feedback de inexistencia).
  // Un `[[#Encabezado]]` apunta a esta misma nota: existe.
  const noteExists = useCallback((target: string) => {
    if (esAnclaPropia(target)) return true;
    const { notas, carpetas } = useVaultStore.getState();
    return resolverReferencia(target, notas, carpetas).nota !== undefined;
  }, []);

  // Lo que muestra un enlace sin alias en la vista en vivo: `Tomate › Cuidados`
  // para `[[Tomate#Cuidados]]`, pero `Q# y Quantum` para la nota que se llama
  // así (`DEF-141`). Por eso resuelve contra el vault y no solo por la sintaxis.
  const etiquetaDe = useCallback((target: string) => {
    const { notas, carpetas } = useVaultStore.getState();
    const r = resolverReferencia(target, notas, carpetas);
    return etiquetaDeReferencia(r.base, r.ancla);
  }, []);

  // ── Guardado al disco ───────────────────────────────────────────
  //
  // Sin caché local ni estados «offline»/«conflicto» (`FUN-M-40`, D7 ·
  // `DEF-113`): eran de la web, donde el remoto es un servidor. En desktop el
  // «remoto» es el propio disco, y la caché de IndexedDB —por origen, con la
  // nota como clave y sin el vault— hacía que dos vaults con la misma ruta
  // relativa se mostraran el contenido el uno del otro al abrir, y un aviso de
  // conflicto que no correspondía.

  /** El archivo cambió por fuera y hay cambios propios: pausa y barra (`DEF-138`). */
  const entrarEnConflicto = useCallback(() => {
    conflictoRef.current = true;
    setConflicto(true);
    setSyncState("conflicto");
    // Para que cerrar la pestaña pregunte en vez de tirar lo del usuario.
    registrarConflicto(instanceId, notaIdRef.current, () => guardarCopiaRef.current());
  }, [setSyncState, instanceId]);

  const salirDeConflicto = useCallback(() => {
    if (!conflictoRef.current) return;
    conflictoRef.current = false;
    setConflicto(false);
    olvidarConflicto(instanceId);
  }, [instanceId]);

  /**
   * Escribe lo pendiente. `true` si quedó guardado.
   *
   * Antes de escribir, la capa de datos compara el disco con lo último que
   * este editor leyó o guardó (`esperado`, `DEF-138`): si el archivo cambió
   * por fuera, no escribe y la nota entra en conflicto. Con `forzar` —el
   * usuario eligió «Quedarme con lo mío»— se escribe igual.
   */
  const syncNow = useCallback(async (opciones?: { forzar?: boolean }): Promise<boolean> => {
    const forzar = opciones?.forzar === true;
    if (!dirtyRef.current || syncingRef.current) return false;
    // En conflicto el guardado está en pausa: solo escribe una decisión explícita.
    if (conflictoRef.current && !forzar) return false;
    syncingRef.current = true;
    setSyncState("syncing");
    // Lo que se manda, fijado ANTES del await (`DEF-117`): mientras el guardado
    // viaja se puede seguir escribiendo, y eso nuevo todavía no está en disco.
    const enviado = contentRef.current;
    try {
      await api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
        method: "PUT",
        token: useAuthStore.getState().accessToken,
        body: forzar ? { contenido: enviado } : { contenido: enviado, esperado: ultimoGuardadoRef.current },
      });
      ultimoGuardadoRef.current = enviado;
      guardadosRef.current++;
      if (forzar) salirDeConflicto();
      // Solo queda «guardado» si no se escribió nada durante el guardado. Antes
      // se marcaba siempre, y lo tipeado en ese intervalo quedaba como si
      // estuviera en disco: la recarga que dispara el propio guardado (el
      // watcher lo ve como un cambio) lo pisaba con la versión vieja, y se
      // perdían las últimas palabras.
      if (contentRef.current !== enviado) {
        // Lo de antes quedó en disco, pero lo nuevo no: sigue pendiente y lo
        // escribe el próximo guardado. `false` porque NO quedó todo guardado —
        // quien cierra la pestaña lo usa para decidir si queda limpia.
        setSyncState("local");
        return false;
      }
      dirtyRef.current = false;
      setSyncState("synced");
      // El contenido (y por ende los [[enlaces]]) cambió → refrescar el grafo.
      useGraphStore.getState().markStale();
      // Y lo que muestre propiedades de muchas notas a la vez —un archivo tabla
      // abierto en otro panel— tiene que enterarse (`DEF-086`). El `PUT` ya
      // reindexó las propiedades, así que lo que se lea ahora es lo nuevo.
      window.dispatchEvent(new CustomEvent(EVENTO_NOTA_GUARDADA, { detail: { notaId } }));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Cambió por fuera desde la última lectura: no se escribió nada.
        entrarEnConflicto();
        return false;
      }
      setSyncState(conflictoRef.current ? "conflicto" : "error");
      return false;
    } finally {
      syncingRef.current = false;
    }
  }, [notaId, setSyncState, entrarEnConflicto, salirDeConflicto]);

  const onDocChanged = useCallback(
    (doc: string) => {
      contentRef.current = doc;
      dirtyRef.current = true;
      // En conflicto se puede seguir escribiendo, pero no se guarda (`DEF-138`).
      setSyncState(conflictoRef.current ? "conflicto" : "local");

      if (previewTimer.current) clearTimeout(previewTimer.current);
      // Debounce adaptativo (`FUN-M-38`, H5): `renderNota` corre entero y en el
      // hilo principal, y en una nota grande tarda más que el propio debounce
      // (medido: 0,5 s en 135 KB, 1,9 s en 444 KB). Con la espera fija, cada
      // pausa de 130 ms al escribir en split volvía a pagar ese bloqueo. Se
      // espera al menos tres veces lo que duró el último render, así que en una
      // nota chica no cambia nada y en una grande los bloqueos se espacian.
      const espera = Math.max(PREVIEW_DEBOUNCE_MS, 3 * ultimoRenderMs.current);
      previewTimer.current = setTimeout(() => {
        if (modeRef.current === "split" || modeRef.current === "read") {
          const inicio = performance.now();
          setPreviewHtml(renderNota(contentRef.current, true));
          ultimoRenderMs.current = performance.now() - inicio;
        }
      }, espera);
    },
    [setSyncState],
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

      // La carga inicial no es un cambio del documento: las palabras de la
      // barra de estado se cuentan acá, las siguientes en el updateListener.
      useSyncStore.getState().setPalabras(notaId, contarPalabras(content));

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
            frasesEditor,
            // Nombre accesible del área de texto: sin esto un lector de pantalla
            // anuncia «campo de texto» sin decir qué nota es. Se evalúa en cada
            // actualización de la vista, así acompaña un renombrado.
            EditorView.contentAttributes.of(() => {
              const titulo = useVaultStore
                .getState()
                .notas.find((n) => n.id === notaIdRef.current)?.titulo;
              return { "aria-label": titulo ? `Nota: ${titulo}` : "Nota" };
            }),
            history(),
            // Tab/Shift+Tab indentan la línea (sangría) en vez de mover el foco.
            keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
            formatKeymap,
            // Autocierre de pares ()[]{}""''``** __ con envoltura de la selección;
            // se consulta la preferencia en cada pulsación (toggle en vivo).
            autoPairs(() => usePreferencesStore.getState().prefs.autoCloseBrackets),
            // Corrector ortográfico con motor propio (`FUN-L-12`), con lo que no
            // es prosa —código, enlaces, fórmulas— excluido. Se lee en cada
            // actualización: el interruptor de Configuración rige al instante.
            correctorOrtografico(() => usePreferencesStore.getState().prefs.correctorOrtografico),
            // Panel propio: la UI real es SearchBar (HU-31); el panel nativo
            // se reemplaza por un nodo vacío para activar el resaltado.
            // `top: true` NO es cosmetico: sin el, CodeMirror clasifica el panel
            // como INFERIOR, y PanelGroup.scrollMargin() calcula la rama de abajo
            // como min(innerHeight, scrollDOM.bottom) - panel.top. Con el panel
            // oculto por CSS su rect es todo ceros, asi que ese margen pasa a
            // valer la altura de la VENTANA en vez de 0: el editor cree que hay
            // 700 px tapandolo por abajo, infla el rectangulo objetivo y aparca
            // el cursor por encima del borde al moverse con las flechas
            // (DEF-059, y la misma causa del DEF-056 y del DEF-031 al arrastrar).
            // La rama superior si tolera el rect en ceros: termina en un
            // Math.max(0, ...) sobre un negativo.
            search({ createPanel: () => ({ dom: document.createElement("div"), top: true }) }),
            markdown({ extensions: GFM_MYCELIUM, codeLanguages: languages }),
            // Autocompletado de wikilinks al escribir dentro de `[[` (estilo
            // Obsidian); inserta la ruta de carpeta si el nombre es ambiguo.
            autocompletion({ override: [wikilinkCompletions] }),
            // Plegar secciones por título (raw + edición en vivo): flecha en el
            // gutter sobre cada título; pliega hasta el próximo título <= nivel.
            codeFolding(),
            // El orden de los márgenes es el orden en que se declaran, y el
            // de números va PRIMERO: así queda a la izquierda y la flecha de
            // plegar pegada al texto, como en VS Code. Al revés —que es como
            // estaba— el número quedaba lejos de la línea que numera.
            numerosCompartment.current.of(numerosDeLinea ? numerosDeLineaExt() : []),
            // Marca propia (`DEF-088`): el estado va en `data-plegado` y no se
            // deduce del `title` de CodeMirror, que está en inglés, en otro
            // elemento y con mayúscula —la regla que giraba la flecha nunca se
            // aplicó—. El glifo se conserva por su caja de línea (ver
            // .cm-foldGutter en editor.css); la flecha la dibuja el ::before.
            foldGutter({
              markerDOM: (abierto) => {
                const marca = document.createElement("span");
                marca.className = "mic-fold-marca";
                marca.dataset.plegado = String(!abierto);
                marca.textContent = abierto ? "⌄" : "›";
                marca.title = abierto
                  ? "Plegar sección (Ctrl+Shift+[)"
                  : "Desplegar sección (Ctrl+Shift+])";
                return marca;
              },
            }),
            headingFoldService,
            // Título (nombre del archivo) como bloque al inicio del documento.
            docTitleField,
            // Quién renombra cuando se escribe en el título (`FUN-M-24`). Es una
            // función estable que lee el id por referencia: la vista se crea una
            // vez y el facet no se reconfigura, así que no puede capturar el
            // `notaId` de este render — al renombrar, el id cambia.
            renombrarPorTitulo.of((titulo) =>
              useVaultStore.getState().renameNota(notaIdRef.current, titulo).then(() => {}),
            ),
            // Desde qué carpeta se resuelve `![](foto.png)` en la vista en vivo
            // (`DEF-126`). Por referencia, como el de arriba.
            carpetaDeLaNota.of(() => carpetaDeNota(notaIdRef.current)),
            // Adónde va el foco al confirmar o descartar el título (`DEF-139`).
            // A la vista VIVA (`viewRef`), no a la del widget: si se renombró, esa
            // ya está destruida y otra ocupa su lugar. Un frame de margen para que
            // React termine de montarla; si aún no está, la toma `createView`.
            salirDelTitulo.of((destino) => {
              requestAnimationFrame(() => {
                const v = viewRef.current;
                if (v && v.dom.isConnected) enfocarTrasTitulo(v, destino);
                else focoTrasTituloRef.current = destino;
              });
            }),
            EditorView.lineWrapping,
            placeholder("Escribí tu nota…"),
            liveCompartment.current.of(
              modeRef.current === "live" ? liveExtensions(openByTitle, noteExists, etiquetaDe) : [],
            ),
            tabCompartment.current.of(
              extensionesTab(usePreferencesStore.getState().prefs.tabWidth),
            ),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              const doc = update.state.doc.toString();
              // Palabras para la barra de estado: también cuando el cambio vino
              // de otra instancia o de disco (carga inicial incluida).
              if (palabrasTimer.current) clearTimeout(palabrasTimer.current);
              palabrasTimer.current = setTimeout(
                () => useSyncStore.getState().setPalabras(notaId, contarPalabras(doc)),
                PALABRAS_DEBOUNCE_MS,
              );
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

      // El cursor y el `scrollTo` ya viajaron en la creación de la vista; queda
      // sembrar los refs para no perder la posición si el usuario vuelve a
      // cambiar de pestaña sin haber hecho scroll (DEF-039).
      if (restaurable) {
        scrollSnapshotRef.current = cached.scroll;
        previewScrollRef.current = cached.previewScrollTop;
        previewScrollPendienteRef.current =
          cached.previewScrollTop > 0 ? cached.previewScrollTop : null;
        plegadosLecturaRef.current = cached.plegadosLectura;
        // El plegado de CodeMirror vive en el estado, y la vista se destruye al
        // cambiar de pestaña (`DEF-065`), así que se repone con los efectos que
        // lo producen. Solo si el documento es el mismo: un rango viejo sobre
        // otro texto plegaría cualquier cosa.
        if (cached.plegadosEdicion.length > 0) {
          viewRef.current.dispatch({
            effects: cached.plegadosEdicion
              .filter((r) => r.to <= content.length)
              .map((r) => foldEffect.of(r)),
          });
        }
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
      const pendiente = takePendingMatch(notaId);
      if (pendiente) saltar(viewRef.current, pendiente);

      // Nota recién creada (`DEF-135`): el foco va al título, seleccionado, para
      // que lo primero que se escriba la nombre. Si el título no se muestra, al
      // cuerpo; en modo lectura no hay dónde escribir y no se toca nada.
      if (tomarEdicionDeTitulo(notaId) && modeRef.current !== "read") {
        const view = viewRef.current;
        if (!editarTitulo(view)) view.focus();
      }

      // Se confirmó el título y la vista que había se desmontó antes de poder
      // enfocarla (`DEF-139`): esta es la que la reemplaza.
      const focoPendiente = focoTrasTituloRef.current;
      if (focoPendiente !== null) {
        focoTrasTituloRef.current = null;
        if (modeRef.current !== "read") enfocarTrasTitulo(viewRef.current, focoPendiente);
      }
    },
    [onDocChanged, openByTitle, noteExists, etiquetaDe, saltar, notaId, instanceId, paneId],
  );

  /**
   * Pone `content` en el editor cambiando **solo el tramo que difiere**
   * (`DEF-117`). Reemplazar el documento entero —como se hacía— tira la
   * selección y el scroll: con cada recarga el cursor saltaba al inicio y lo
   * siguiente se escribía en otro lugar. Con el cambio acotado, CodeMirror
   * reubica el cursor por sí mismo y la vista no se mueve.
   */
  const applyContent = useCallback((content: string) => {
    const view = viewRef.current;
    if (!view) return;
    const actual = view.state.doc.toString();
    if (actual === content) return;
    let desde = 0;
    const tope = Math.min(actual.length, content.length);
    while (desde < tope && actual.charCodeAt(desde) === content.charCodeAt(desde)) desde++;
    let finActual = actual.length;
    let finNuevo = content.length;
    while (
      finActual > desde &&
      finNuevo > desde &&
      actual.charCodeAt(finActual - 1) === content.charCodeAt(finNuevo - 1)
    ) {
      finActual--;
      finNuevo--;
    }
    view.dispatch({
      changes: { from: desde, to: finActual, insert: content.slice(desde, finNuevo) },
    });
  }, []);

  /** Lo que tiene el archivo AHORA, sin pasar por el índice (`DEF-138`). */
  const leerDisco = useCallback(async (): Promise<string | null> => {
    const r = await api<{ contenido: string | null }>(
      `/notas/${encodeURIComponent(notaIdRef.current)}/contenido?origen=disco`,
      { token: useAuthStore.getState().accessToken },
    );
    return r.contenido;
  }, []);

  /**
   * Pone en el editor lo que hay en disco y deja la nota limpia. Va por
   * `applyContent`, así que entra al historial: Ctrl+Z vuelve a lo que había.
   */
  const aplicarDelDisco = useCallback(
    (disco: string) => {
      brokerApplyRef.current = true;
      applyContent(disco);
      brokerApplyRef.current = false;
      contentRef.current = disco;
      ultimoGuardadoRef.current = disco;
      dirtyRef.current = false;
      salirDeConflicto();
      setSyncState("synced");
      // El cambio vino de disco, así que el updateListener no publicó nada: se
      // avisa a mano para que los suscriptores (el panel de propiedades, otras
      // instancias de la nota) no se queden con el texto viejo.
      publishDoc(notaIdRef.current, instanceId, disco);
    },
    [applyContent, instanceId, salirDeConflicto, setSyncState],
  );

  // ── Cambio EXTERNO del archivo (modo carpeta, fase 5 · `DEF-138`) ──
  //
  // El watcher del vault detectó que algo cambió en disco (o se vuelve a la
  // pestaña). Se lee el archivo tal como está y se decide con
  // `decidirAnteCambioExterno`: sin cambios propios, se trae lo de afuera; con
  // cambios propios, la nota entra en conflicto —no se recarga NI se guarda— y
  // el usuario elige en la barra. Antes, con cambios propios se ignoraba el
  // aviso y el próximo guardado pisaba lo de afuera en silencio (`DEF-138`).
  const revisarDisco = useCallback(async () => {
    // Con un guardado en vuelo, la foto del disco no sirve: el propio guardado
    // compara contra la base antes de escribir.
    if (!viewRef.current || syncingRef.current) return;
    const guardados = guardadosRef.current;
    try {
      const disco = await leerDisco();
      if (!viewRef.current || syncingRef.current || guardados !== guardadosRef.current) return;
      const decision = decidirAnteCambioExterno({
        disco,
        conocido: ultimoGuardadoRef.current,
        local: contentRef.current,
        sucio: dirtyRef.current,
      });
      if (decision === "recargar" && disco !== null) {
        aplicarDelDisco(disco);
      } else if (decision === "alcanzado" && disco !== null) {
        // Afuera quedó exactamente lo que se ve: no hay nada que guardar.
        ultimoGuardadoRef.current = disco;
        dirtyRef.current = false;
        salirDeConflicto();
        setSyncState("synced");
      } else if (decision === "conflicto") {
        entrarEnConflicto();
      } else if (conflictoRef.current && disco !== null && disco === ultimoGuardadoRef.current) {
        // Lo de afuera se deshizo (el disco volvió a la base): ya no hay
        // conflicto, y lo propio vuelve a guardarse solo.
        salirDeConflicto();
        setSyncState(dirtyRef.current ? "local" : "synced");
      }
    } catch {
      // Best-effort: si falla la relectura, no se toca lo que hay en pantalla.
    }
  }, [leerDisco, aplicarDelDisco, salirDeConflicto, entrarEnConflicto, setSyncState]);

  // ── Resolver el conflicto: las tres salidas de la barra (`DEF-138`) ──

  /** «Ver lo de afuera»: descarta lo propio (con confirmación; Ctrl+Z lo trae). */
  const verLoDeAfuera = useCallback(async () => {
    const titulo =
      useVaultStore.getState().notas.find((n) => n.id === notaIdRef.current)?.titulo ?? "la nota";
    const acepta = await confirmar(
      `Se descartan tus cambios sin guardar en «${titulo}» y se muestra lo que tiene el archivo ahora. ` +
        "Si te arrepentís, Ctrl+Z en la nota los trae de vuelta.",
      "Ver lo de afuera",
    );
    if (!acepta) return;
    setResolviendo(true);
    try {
      const disco = await leerDisco();
      if (disco === null) {
        avisar("El archivo ya no está en disco: se conserva lo tuyo.");
        return;
      }
      aplicarDelDisco(disco);
    } catch (e) {
      avisarFallo("leer el archivo")(e);
    } finally {
      setResolviendo(false);
    }
  }, [leerDisco, aplicarDelDisco]);

  /** «Quedarme con lo mío»: escribe lo propio encima, por decisión explícita. */
  const quedarmeConLoMio = useCallback(async () => {
    setResolviendo(true);
    try {
      // Con la misma nota en dos paneles, el espejo puede no estar marcado
      // sucio aunque tenga lo escrito en el otro: se escribe igual.
      dirtyRef.current = true;
      await syncNow({ forzar: true });
    } finally {
      setResolviendo(false);
    }
  }, [syncNow]);

  /**
   * «Guardar lo mío como copia»: lo propio va a una nota nueva al lado
   * —«Título (copia local)»— y en esta se carga lo de afuera. Nada se pierde.
   * `true` si lo propio quedó a salvo. Sirve también al cerrar la pestaña.
   */
  const guardarCopia = useCallback(async (): Promise<boolean> => {
    const vault = useVaultStore.getState();
    const nota = vault.notas.find((n) => n.id === notaIdRef.current);
    const local = contentRef.current;
    setResolviendo(true);
    try {
      const nuevoId = await vault.createNota(
        nota?.carpetaId ?? null,
        "markdown",
        tituloDeCopiaLocal(nota?.titulo ?? "Sin título"),
      );
      await api(`/notas/${encodeURIComponent(nuevoId)}/contenido`, {
        method: "PUT",
        token: useAuthStore.getState().accessToken,
        body: { contenido: local },
      });
      const disco = await leerDisco();
      if (disco !== null) {
        if (viewRef.current) aplicarDelDisco(disco);
        else {
          // Pestaña que no se ve: su texto vive en la caché de la pestaña.
          const entrada = instanceCache.get(instanceId);
          if (entrada) Object.assign(entrada, { doc: disco, conocido: disco, sucio: false, conflicto: false });
          conflictoRef.current = false;
          olvidarConflicto(instanceId);
          setSyncState("synced");
        }
      } else {
        // El archivo ya no está: lo propio quedó en la copia y acá se conserva.
        salirDeConflicto();
      }
      const tituloCopia = useVaultStore.getState().notas.find((n) => n.id === nuevoId)?.titulo;
      avisar(`Lo tuyo quedó en «${tituloCopia ?? tituloDeCopiaLocal(nota?.titulo ?? "")}».`, {
        etiqueta: "Abrir",
        hacer: () => {
          useTabsStore.getState().openNote(nuevoId);
          router.replace(`/workspace?note=${nuevoId}`);
        },
      });
      return true;
    } catch (e) {
      avisarFallo("guardar tu versión como copia")(e);
      return false;
    } finally {
      setResolviendo(false);
    }
  }, [leerDisco, aplicarDelDisco, salirDeConflicto, setSyncState, instanceId, router]);
  useEffect(() => {
    guardarCopiaRef.current = guardarCopia;
  }, [guardarCopia]);

  // ── Carga inicial: del disco, y listo (`FUN-M-40`, D7) ─────────
  //
  // Lo único que se recuerda entre montajes es el estado de la PESTAÑA
  // (`instanceCache`): el texto, el cursor, el scroll y los plegados de esta
  // pestaña mientras está abierta. Nada que sobreviva a cerrarla ni que se
  // comparta entre vaults.

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Volver a una pestaña: se pinta su texto enseguida, sin esperar al disco.
      const instance = instanceCache.get(instanceId);
      if (instance) {
        createView(instance.doc);
        // El guardado de al salir puede estar viajando: se espera, o lo que
        // escribe se confundiría con un cambio de afuera.
        if (instance.guardando) await instance.guardando;
        if (cancelled) return;
        // La base es la de la pestaña, no lo que hay ahora en disco: si se
        // tomara el disco, un cambio de afuera hecho mientras tanto quedaría
        // absorbido y el próximo guardado lo pisaría (`DEF-138`).
        ultimoGuardadoRef.current = instance.conocido;
        if (instance.sucio) dirtyRef.current = true;
        if (instance.conflicto) entrarEnConflicto();
        else setSyncState(dirtyRef.current ? "local" : "synced");
        // Lo que haya pasado en disco mientras tanto: recargar si la pestaña
        // estaba limpia, conflicto si tenía cambios propios.
        await revisarDisco();
        return;
      }

      try {
        const remote = await api<{ contenido: string }>(
          `/notas/${encodeURIComponent(notaId)}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        if (cancelled) return;

        ultimoGuardadoRef.current = remote.contenido;
        createView(remote.contenido);
        setSyncState("synced");
      } catch {
        if (!cancelled) {
          if (!viewRef.current) createView("");
          setSyncState("error");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      soltarScrollRef.current?.();
      soltarScrollRef.current = null;
      const view = viewRef.current;
      if (view) {
        // Cursor/scroll de la pestaña para restaurar al volver (HU-25 CA10).
        // OJO (DEF-039): acá NO se puede leer el scroll del DOM — React ya
        // desmontó el nodo y `scrollTop` valdría 0. Se usa lo capturado en vivo.
        const { anchor, head } = view.state.selection.main;
        const plegadosEdicion: { from: number; to: number }[] = [];
        foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
          plegadosEdicion.push({ from, to });
        });
        instanceCache.set(instanceId, {
          doc: contentRef.current,
          anchor,
          head,
          scroll: scrollSnapshotRef.current,
          previewScrollTop: previewScrollRef.current,
          plegadosEdicion,
          plegadosLectura: plegadosLecturaRef.current,
          sucio: dirtyRef.current,
          conocido: ultimoGuardadoRef.current,
          conflicto: conflictoRef.current,
          guardando: null,
        });
        unregisterView(paneId, view);
        view.destroy();
      }
      viewRef.current = null;
      // Al abandonar la nota: guardado inmediato si hay cambios (HU-04 CA2).
      // Cuando termina bien, la pestaña deja de estar sucia (ver `sucio`).
      // En conflicto no se guarda (`DEF-138`): lo propio queda en la caché de
      // la pestaña y el conflicto sigue registrado para cuando vuelva o cierre.
      const entrada = instanceCache.get(instanceId);
      if (dirtyRef.current && !conflictoRef.current && entrada) {
        entrada.guardando = syncNow().then((ok) => {
          if (ok) {
            entrada.sucio = false;
            entrada.conocido = ultimoGuardadoRef.current;
          }
          // El guardado pudo toparse con un cambio de afuera (409).
          entrada.conflicto = conflictoRef.current;
          entrada.guardando = null;
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaId]);

  // Salto a coincidencia cuando la nota ya estaba abierta (HU-21 CA8)
  useEffect(() => {
    function onGoto(event: Event) {
      const detail = (
        event as CustomEvent<{ notaId: string; term?: string; linea?: number; ancla?: string }>
      ).detail;
      if (detail?.notaId !== notaId) return;
      const view = viewRef.current;
      if (!view) return;
      const salto: Salto =
        typeof detail.ancla === "string"
          ? { ancla: detail.ancla }
          : typeof detail.linea === "number"
            ? { linea: detail.linea }
            : (detail.term ?? "");
      takePendingMatch(notaId);
      // Un ancla se busca en el contenido: si la vista todavía no lo tiene (la
      // nota se está cargando), el salto queda pendiente para la carga.
      if (saltar(view, salto) === null && typeof salto !== "string" && "ancla" in salto) {
        setPendingMatch(notaId, salto);
      }
    }
    window.addEventListener("micelio:goto-match", onGoto);
    return () => window.removeEventListener("micelio:goto-match", onGoto);
  }, [notaId, saltar]);

  // Cambios externos del vault (modo carpeta, fase 5). El evento lo dispara
  // `vaultWatch` tras reindexar, con las rutas de la ráfaga: solo se mira el
  // disco si tocó a esta nota. `revisarDisco` decide entre recargar y entrar en
  // conflicto (`DEF-138`).
  //
  // También al guardarse esta nota desde OTRA instancia (la misma nota en otro
  // panel): si lo escrito coincide con lo que se ve acá, un conflicto de este
  // lado se resolvió allá.
  useEffect(() => {
    function onRecarga(e: Event) {
      if (avisoTocaA(e, notaIdRef.current)) void revisarDisco();
    }
    function onGuardada(e: Event) {
      if ((e as CustomEvent<{ notaId?: string }>).detail?.notaId === notaIdRef.current) {
        void revisarDisco();
      }
    }
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    window.addEventListener(EVENTO_NOTA_GUARDADA, onGuardada);
    return () => {
      window.removeEventListener(EVENTO_RECARGA, onRecarga);
      window.removeEventListener(EVENTO_NOTA_GUARDADA, onGuardada);
    };
  }, [revisarDisco]);

  // Espejo en tiempo real con otras instancias de la misma nota
  useEffect(() => {
    return subscribeDoc(notaId, instanceId, (content) => {
      if (content === contentRef.current) return;
      brokerApplyRef.current = true;
      applyContent(content);
      brokerApplyRef.current = false;
    });
  }, [notaId, instanceId, applyContent]);

  // ── Guardado periódico + beforeunload ───────────────────────────

  // Actualizar cierra la app (FUN-L-14): el updater fuerza acá el guardado
  // pendiente y ESPERA a que termine antes de lanzar el instalador. Sin esto,
  // lo escrito entre la última tecla y el debounce se perdería al reiniciar.
  useEffect(() => {
    registrarGuardadoPendiente(`nota:${instanceId}`, async () => {
      await syncNow();
    });
    return () => olvidarGuardadoPendiente(`nota:${instanceId}`);
  }, [instanceId, syncNow]);

  useEffect(() => {
    const interval = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const onBeforeUnload = () => {
      // Guardado best-effort al cerrar: en el escritorio va a SQLite vía el
      // dispatcher local (antes era un fetch al backend .NET).
      if (conflictoRef.current) {
        // En conflicto no se puede preguntar ni esperar: lo propio se escribe
        // en un archivo aparte, con fecha y hora, y el de la nota queda como lo
        // dejaron afuera (`DEF-138`). Una sola escritura, sin pasar por el índice
        // —el próximo indexado lo encuentra—.
        void escribirNota(
          getVaultActual(),
          rutaDeCopiaDeEmergencia(notaId, new Date()),
          contentRef.current,
        ).catch(() => {});
      } else if (dirtyRef.current) {
        void api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
          method: "PUT",
          body: { contenido: contentRef.current, esperado: ultimoGuardadoRef.current },
        });
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(interval);
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
          next === "live" ? liveExtensions(openByTitle, noteExists, etiquetaDe) : [],
        ),
      });
      if (next === "split" || next === "read") {
        setPreviewHtml(renderNota(contentRef.current, true));
      }
      // El foco se queda en el boton del modo que se acaba de pulsar, asi que
      // las flechas mueven el foco entre botones en vez de mover el cursor y
      // hay que volver a hacer clic en el texto. Se devuelve al editor en
      // cuanto vuelve a estar visible; en lectura no, porque ahi esta oculto y
      // enfocarlo desplazaria el contenedor.
      if (next !== "read") requestAnimationFrame(() => viewRef.current?.focus());
    },
    [notaId, openByTitle, noteExists, etiquetaDe],
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
  // Las imágenes no son notas: se resuelven contra los otros archivos (`DEF-126`).
  const vaultOtros = useVaultStore((s) => s.otros);

  // Diagramas Mermaid (HU-18) y Excalidraw (HU-16) en el preview
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      void renderMermaidIn(previewRef.current);
      void renderExcalidrawIn(previewRef.current);
      void renderDrawioIn(previewRef.current);
      rellenarImagenesEn(previewRef.current, carpetaDeNota(notaId)); // `DEF-126`
      addCodeCopyButtons(previewRef.current); // botón copiar en bloques de código
    }
  }, [previewHtml, mode, previewTick, notaId, vaultNotas, vaultCarpetas, vaultOtros]);

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
      attachHeadingFolds(previewRef.current, plegadosLecturaRef.current);
    }
  });

  // Feedback de inexistencia: oscurece los wikilinks a archivos que no existen.
  useEffect(() => {
    if ((mode === "split" || mode === "read") && previewRef.current) {
      markMissingWikilinks(previewRef.current, vaultNotas, vaultCarpetas);
    }
  }, [previewHtml, mode, previewTick, vaultNotas, vaultCarpetas]);

  /**
   * Inserta en el cursor el embed del dibujo `id`, recién creado. Por título, y
   * con la carpeta delante si otro archivo se llama igual: el nombre solo se
   * desambigua dentro de la carpeta, y `![[Dibujo sin título.excalidraw]]` a
   * secas resolvería al de la raíz (`refUnivoca`).
   */
  const insertarEmbedDeDibujo = useCallback((id: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { notas, carpetas } = useVaultStore.getState();
    const nota = notas.find((n) => n.id === id);
    const ref = nota ? refUnivoca(nota, notas, carpetas) : TITULO_POR_DEFECTO.excalidraw;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, insert: `![[${ref}.excalidraw]]` } });
  }, []);

  /**
   * Crea un archivo .excalidraw REAL en la carpeta de la nota actual (aparece en
   * el explorador y es manipulable como cualquier nota), inserta su embed y abre
   * el panel de edición embebido (modal) para dibujar enseguida, sin salir del
   * markdown (HU-16 CA1a).
   */
  const insertDiagram = useCallback(() => {
    if (!viewRef.current) return;
    const vault = useVaultStore.getState();
    const carpetaId = vault.notas.find((n) => n.id === notaId)?.carpetaId ?? null;
    void vault
      .createNota(carpetaId, "excalidraw")
      .then((newId) => {
        insertarEmbedDeDibujo(newId);
        setEditingFile(newId); // abrir el editor embebido del nuevo dibujo
      })
      .catch(avisarFallo("crear el dibujo")); // `DEF-136`
  }, [notaId, insertarEmbedDeDibujo]);

  /**
   * Un `.excalidraw` soltado sobre el editor (HU-16 CA1b) se vuelve un archivo
   * del vault, en la carpeta de la nota y con el nombre del archivo soltado
   * (desambiguado como cualquier creación), y se inserta su embed: lo mismo que
   * hace la barra de herramientas (`FUN-M-40`, D6).
   *
   * Antes la escena se guardaba en una tabla `diagramas` del índice, colgada de
   * la nota, con un embed `![[<uuid>.excalidraw]]` (`DEF-112`): no había
   * archivo, así que reconstruir el índice la perdía sin aviso.
   */
  const soltarDibujo = useCallback(
    async (file: File) => {
      const texto = await file.text();
      try {
        JSON.parse(texto);
      } catch {
        avisar(`«${file.name}» no es un dibujo de Excalidraw válido`);
        return;
      }
      try {
        const vault = useVaultStore.getState();
        const carpetaId =
          vault.notas.find((n) => n.id === notaIdRef.current)?.carpetaId ?? null;
        const nombre = file.name.replace(/\.excalidraw$/i, "");
        const nuevoId = await vault.createNota(carpetaId, "excalidraw", nombre);
        // El contenido se guarda tal cual vino: es el archivo del usuario.
        await api(`/notas/${encodeURIComponent(nuevoId)}/contenido`, {
          method: "PUT",
          body: { contenido: texto },
        });
        insertarEmbedDeDibujo(nuevoId);
      } catch (e) {
        console.error("[Mycelium] no se pudo importar el dibujo soltado", e);
        avisar(`No se pudo importar «${file.name}»`);
      }
    },
    [insertarEmbedDeDibujo],
  );

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
      // Casilla de una tarea (lectura/dividido): alterna su marcador en el doc
      // como en Obsidian —pendiente ↔ hecha; un estado especial vuelve a
      // pendiente—; el preview se re-renderiza y se autoguarda (`FUN-S-01`).
      const tarea = casillaDeTarea(event.target);
      if (tarea) {
        event.preventDefault();
        if (viewRef.current) cambiarSimboloTarea(viewRef.current, tarea.pos, simboloAlClic(tarea.simbolo));
        return;
      }
      const diagram = (event.target as HTMLElement).closest(".mic-excalidraw-block");
      if (diagram) {
        // Archivo .excalidraw del vault → editarlo en el modal embebido, sin
        // salir del markdown (HU-16 CA3). Sin `data-nota`, el embed no nombra
        // ningún dibujo y ya muestra su aviso: no hay nada que abrir.
        const targetNota = diagram.getAttribute("data-nota");
        if (targetNota) setEditingFile(targetNota);
        return;
      }
      // Un diagrama de draw.io embebido es una vista previa, no un editor: el
      // clic abre su pestaña (`FUN-L-20` § 8). Un editor por embed sería la
      // webapp entera cargada una vez por diagrama de la nota.
      const diagramaDrawio = (event.target as HTMLElement).closest(".mic-drawio-block");
      if (diagramaDrawio) {
        const targetNota = diagramaDrawio.getAttribute("data-nota");
        if (targetNota) {
          useTabsStore.getState().openNote(targetNota);
          router.replace(`/workspace?note=${targetNota}`);
        }
        return;
      }
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Un enlace a una página web abre el navegador del sistema y NO navega la
      // webview: hacerlo se llevaba la app entera (`DEF-101`).
      if (manejarClicDeEnlace(event, href)) return;
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
      // Clic derecho (o la tecla de menú, con la casilla enfocada) sobre una
      // tarea: el menú con todos sus estados (`FUN-S-01`).
      const tarea = casillaDeTarea(event.target);
      if (tarea) {
        event.preventDefault();
        let { clientX: x, clientY: y } = event;
        if (x === 0 && y === 0) {
          // Desde el teclado el evento no trae coordenadas: se abre junto a la casilla.
          const r = (event.target as HTMLElement).getBoundingClientRect();
          x = r.left;
          y = r.bottom;
        }
        setDiagMenu({
          x,
          y,
          items: itemsEstadosTarea(tarea.simbolo, (nuevo) => {
            if (viewRef.current) cambiarSimboloTarea(viewRef.current, tarea.pos, nuevo);
          }),
        });
        return;
      }
      const diagram = (event.target as HTMLElement).closest(".mic-excalidraw-block");
      if (!diagram) return;
      event.preventDefault();
      const ref = diagram.getAttribute("data-diag");
      if (!ref) return;
      setDiagMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: "Exportar como PNG",
            onClick: () => void exportDiagram(ref, "png"),
          },
          {
            label: "Exportar como SVG",
            onClick: () => void exportDiagram(ref, "svg"),
          },
        ],
      });
    },
    [],
  );

  const notaTitulo = useVaultStore(
    (s) => s.notas.find((n) => n.id === notaId)?.titulo ?? "nota",
  );

  const showFileTitle = usePreferencesStore((s) => s.prefs.showFileTitle);
  const tabWidth = usePreferencesStore((s) => s.prefs.tabWidth);
  // Números de línea (`FUN-M-28`). Es una preferencia DEL VAULT, no del
  // usuario: abrir otro vault trae la suya.
  const numerosDeLinea = usePrefVault("numerosDeLinea");
  // Panel de metadatos embebido a la derecha de ESTE editor, y su toggle es de
  // ESTE pane (`DEF-060`). Leerlo como selector hace que abrirlo en un pane no
  // redibuje los demás.
  const metaPanelOpen = useTabsStore((s) => panelMetaAbierto(s.root, paneId));

  // Cambiar el ancho de tabulación se aplica a los editores ya abiertos
  // (FUN-S-02): reconfigurar el compartimento, no recrear la vista.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabCompartment.current.reconfigure(extensionesTab(tabWidth)),
    });
  }, [tabWidth]);

  // Igual con los números de línea (`FUN-M-28`): reconfigurar, no recrear. Si se
  // recreara la vista, prender el interruptor perdería el cursor, el scroll y el
  // deshacer de cada editor abierto.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: numerosCompartment.current.reconfigure(
        numerosDeLinea ? numerosDeLineaExt() : [],
      ),
    });
  }, [numerosDeLinea]);

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
        onInsertDiagram={insertDiagram}
        notaId={notaId}
        titulo={notaTitulo}
        paneId={paneId}
      />

      {conflicto && (
        // `DEF-138`: el archivo cambió fuera de Mycelium y la nota tiene cambios
        // propios. El guardado está en pausa; nada se pierde sin que se elija.
        <div className={styles.conflictBar} role="alert">
          <span className={styles.conflictTexto}>
            El archivo cambió fuera de Mycelium y tenés cambios sin guardar.
          </span>
          <button type="button" disabled={resolviendo} onClick={() => void verLoDeAfuera()}>
            Ver lo de afuera
          </button>
          <button type="button" disabled={resolviendo} onClick={() => void quedarmeConLoMio()}>
            Quedarme con lo mío
          </button>
          <button type="button" disabled={resolviendo} onClick={() => void guardarCopia()}>
            Guardar lo mío como copia
          </button>
        </div>
      )}

      {isActivePane && (
        <SearchBar
          getView={() => viewRef.current}
          getPreview={() => previewRef.current}
          modoLectura={mode === "read"}
        />
      )}

      <div className={styles.body}>
      <div className={`${styles.content} ${styles[`layout_${mode}`]}`}>
        <div
          ref={hostRef}
          // `mic-con-numeros` le cede al margen el relleno izquierdo del
          // scroller, para que un rango como `34-40` entre sin que el margen
          // cambie de ancho al hacer scroll (`FUN-M-28`).
          className={`mic-editor-host ${numerosDeLinea ? "mic-con-numeros" : ""} ${styles.editorPane}`}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            // Drag & drop de archivos .excalidraw sobre el editor (HU-16 CA1b)
            const file = Array.from(e.dataTransfer.files).find((f) =>
              f.name.toLowerCase().endsWith(".excalidraw"),
            );
            if (!file) return;
            e.preventDefault();
            void soltarDibujo(file);
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
            {/* En lectura el título NO se edita, aunque el widget del editor sí
                (`FUN-M-24`): esta vista es de solo lectura de punta a punta, y
                un solo elemento que sí se pueda tocar la vuelve mentira. El
                `<div>` de dentro lleva el degradado; el de fuera, la caja. */}
            {showFileTitle && (
              <div className="mic-doc-title mic-doc-title-preview">
                <div className="mic-doc-title-texto">{notaTitulo}</div>
              </div>
            )}
            <div className="mic-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>
        {metaPanelOpen && <NotePanel notaId={notaId} paneId={paneId} />}
      </div>

      {diagMenu && <ContextMenu {...diagMenu} onClose={() => setDiagMenu(null)} />}

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
