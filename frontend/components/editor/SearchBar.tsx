"use client";

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { CaseSensitive, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buscarEnDom,
  centrarRango,
  limpiarResaltados,
  pintarResaltados,
} from "@/lib/buscarEnDom";
import { useUiStore } from "@/stores/uiStore";
import styles from "./SearchBar.module.css";

/**
 * Búsqueda y reemplazo en la nota activa (HU-31). Barra flotante entre el
 * AppTopbar y el editor; entry points: Ctrl+F y la barra del topbar (HU-38).
 */
export function SearchBar({
  getView,
  getPreview,
  modoLectura,
  sinReemplazo = false,
  placeholder = "Buscar en la nota…",
}: {
  getView: () => EditorView | null;
  /** Panel de la vista de lectura, donde se busca cuando el editor no se ve. */
  getPreview: () => HTMLElement | null;
  modoLectura: boolean;
  /**
   * Oculta el reemplazo aunque se busque en un editor.
   *
   * `modoLectura` no alcanza para esto: dice *dónde* se busca —en el DOM en vez
   * de en CodeMirror— y son dos cosas distintas. El visor de archivos
   * (`FUN-S-09`) busca en un CodeMirror que es de solo lectura: necesita la
   * búsqueda del editor y **no** el reemplazo, que ahí no escribiría nada y solo
   * parecería roto.
   */
  sinReemplazo?: boolean;
  /** Texto del campo. Lo cambia el visor de archivos (`FUN-L-11`), que no abre notas. */
  placeholder?: string;
}) {
  const open = useUiStore((s) => s.searchInNoteOpen);
  const setOpen = useUiStore((s) => s.setSearchInNoteOpen);

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceWith, setReplaceWith] = useState("");
  const [counts, setCounts] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  // DEF-057: en lectura no hay CodeMirror que resalte, así que las
  // coincidencias se llevan acá. Un ref y no un estado: cambian en cada tecla y
  // solo se leen al navegar.
  const rangosRef = useRef<Range[]>([]);
  const indiceRef = useRef(0);

  const applyQuery = useCallback(
    (search: string, cs: boolean, replace: string) => {
      if (modoLectura) {
        // La vista de lectura es HTML, no un editor: se busca sobre el DOM y se
        // resalta sin tocarlo (ver `lib/buscarEnDom.ts`).
        const panel = getPreview();
        rangosRef.current = panel ? buscarEnDom(panel, search, cs) : [];
        indiceRef.current = 0;
        pintarResaltados(rangosRef.current, 0);
        const total = rangosRef.current.length;
        setCounts({ current: total > 0 ? 1 : 0, total });
        return;
      }
      const view = getView();
      if (!view) return;
      const sq = new SearchQuery({
        search,
        caseSensitive: cs,
        replace,
        literal: true,
      });
      view.dispatch({ effects: setSearchQuery.of(sq) });
      updateCounts(view, sq);
    },
    [getView, getPreview, modoLectura],
  );

  function updateCounts(view: EditorView, sq: SearchQuery) {
    if (!sq.search) {
      setCounts({ current: 0, total: 0 });
      return;
    }
    const cursor = sq.getCursor(view.state);
    let total = 0;
    let current = 0;
    const selFrom = view.state.selection.main.from;
    let item = cursor.next();
    while (!item.done) {
      total++;
      if (item.value.from <= selFrom) current = total;
      item = cursor.next();
    }
    setCounts({ current: Math.max(current, total > 0 ? 1 : 0), total });
  }

  // Abrir/cerrar el panel (oculto) que habilita el resaltado de matches
  useEffect(() => {
    const view = getView();
    if (!view) return;
    if (open) openSearchPanel(view);
    else closeSearchPanel(view);
  }, [open, getView]);

  // Sincronizar query al editor en cada cambio
  useEffect(() => {
    if (open) applyQuery(query, caseSensitive, replaceWith);
  }, [open, query, caseSensitive, replaceWith, applyQuery]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // DEF-057: los resaltados viven en `CSS.highlights`, que es GLOBAL del
  // documento: no desaparecen solos al desmontar la barra ni al cambiar de modo.
  useEffect(() => {
    if (!open || !modoLectura) limpiarResaltados();
    return () => limpiarResaltados();
  }, [open, modoLectura]);

  const navigate = useCallback(
    (forward: boolean) => {
      if (modoLectura) {
        const rangos = rangosRef.current;
        const panel = getPreview();
        if (rangos.length === 0 || !panel) return;
        // Circular, como en el editor: pasar del último vuelve al primero.
        indiceRef.current =
          (indiceRef.current + (forward ? 1 : -1) + rangos.length) % rangos.length;
        pintarResaltados(rangos, indiceRef.current);
        centrarRango(panel, rangos[indiceRef.current]);
        setCounts({ current: indiceRef.current + 1, total: rangos.length });
        return;
      }
      const view = getView();
      if (!view) return;
      if (forward) findNext(view);
      else findPrevious(view);
      // DEF-056: la coincidencia se centra, que es lo que se pidio — con la
      // estrategia por defecto de `findNext` queda pegada al borde superior.
      //
      // Esto se calculaba a mano porque pedirselo a CodeMirror no surtia efecto.
      // La causa era el DEF-059 —el panel oculto envenenaba el margen de scroll—
      // y esta corregida, asi que vuelve a bastar su propia API.
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main, { y: "center" }),
      });
      const sq = new SearchQuery({
        search: query,
        caseSensitive,
        replace: replaceWith,
        literal: true,
      });
      updateCounts(view, sq);
    },
    [getView, getPreview, modoLectura, query, caseSensitive, replaceWith],
  );

  const close = useCallback(() => {
    // Esc cierra y elimina los resaltados (CA9)
    limpiarResaltados();
    rangosRef.current = [];
    const view = getView();
    if (view) {
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "" })),
      });
      view.focus();
    }
    setQuery("");
    setReplaceOpen(false);
    setOpen(false);
  }, [getView, setOpen]);

  if (!open) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(!e.shiftKey);
            if (e.key === "Escape") close();
          }}
        />
        <span className={styles.count}>
          {counts.total > 0 ? `${counts.current} de ${counts.total}` : "0 de 0"}
        </span>
        <button type="button" className={styles.iconButton} title="Anterior (Shift+Enter)" onClick={() => navigate(false)}>
          <ChevronLeft size={15} aria-hidden />
        </button>
        <button type="button" className={styles.iconButton} title="Siguiente (Enter)" onClick={() => navigate(true)}>
          <ChevronRight size={15} aria-hidden />
        </button>
        <button
          type="button"
          className={caseSensitive ? `${styles.iconButton} ${styles.active}` : styles.iconButton}
          title="Distinguir mayúsculas/minúsculas"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive size={15} aria-hidden />
        </button>
        {/* Reemplazar edita el documento, así que no se ofrece si no hay dónde
            escribir: ni en la vista de lectura, ni sobre un editor de solo
            lectura. */}
        {!modoLectura && !sinReemplazo && (
          <button
            type="button"
            className={replaceOpen ? `${styles.iconButton} ${styles.active}` : styles.iconButton}
            title="Reemplazar"
            aria-pressed={replaceOpen}
            onClick={() => setReplaceOpen((v) => !v)}
          >
            <ChevronDown size={15} aria-hidden />
          </button>
        )}
        <button type="button" className={styles.iconButton} title="Cerrar (Esc)" onClick={close}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {replaceOpen && !modoLectura && !sinReemplazo && (
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="Reemplazar por…"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && close()}
          />
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              const view = getView();
              if (view) replaceNext(view);
            }}
          >
            Reemplazar uno
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              const view = getView();
              if (view) replaceAll(view);
            }}
          >
            Reemplazar todos
          </button>
        </div>
      )}
    </div>
  );
}
