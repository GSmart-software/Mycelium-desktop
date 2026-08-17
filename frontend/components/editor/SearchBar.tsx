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
import type { EditorView } from "@codemirror/view";
import { CaseSensitive, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "@/stores/uiStore";
import styles from "./SearchBar.module.css";

/**
 * Búsqueda y reemplazo en la nota activa (HU-31). Barra flotante entre el
 * AppTopbar y el editor; entry points: Ctrl+F y la barra del topbar (HU-38).
 */
export function SearchBar({ getView }: { getView: () => EditorView | null }) {
  const open = useUiStore((s) => s.searchInNoteOpen);
  const setOpen = useUiStore((s) => s.setSearchInNoteOpen);

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceWith, setReplaceWith] = useState("");
  const [counts, setCounts] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const applyQuery = useCallback(
    (search: string, cs: boolean, replace: string) => {
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
    [getView],
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

  const navigate = useCallback(
    (forward: boolean) => {
      const view = getView();
      if (!view) return;
      if (forward) findNext(view);
      else findPrevious(view);
      // DEF-056: el desplazamiento se calcula y se aplica a mano.
      //
      // Pedírselo a CodeMirror no funciona: medido en la app, tras `findNext` la
      // coincidencia quedaba 149 px POR ENCIMA del área visible y ahí se
      // quedaba, sin corregirse ni en el frame siguiente ni a los 300 ms. No es
      // que calcule mal dónde está —su height-map coincide con el DOM salvo 2
      // px— es que da por cumplido un `scrollIntoView` que no cumplió, así que ni
      // `y: "center"` ni `scrollMargins` cambiaban nada.
      //
      // Como las medidas SÍ son fiables, se usan directamente: el bloque de la
      // coincidencia se lleva al centro del scroller asignando `scrollTop`. Va en
      // el frame siguiente para no pelear con el desplazamiento que `findNext`
      // deja pendiente, y acotado a los extremos del documento.
      requestAnimationFrame(() => {
        const v = getView();
        if (!v) return;
        const sc = v.scrollDOM;
        const bloque = v.lineBlockAt(v.state.selection.main.head);
        // Offset del inicio del documento dentro del contenido del scroller
        // (el padding del editor), deducido de lo ya medido en vez de fijarlo.
        const origen = v.documentTop - sc.getBoundingClientRect().top + sc.scrollTop;
        const centrado = origen + bloque.top - (sc.clientHeight - bloque.height) / 2;
        sc.scrollTop = Math.max(0, Math.min(centrado, sc.scrollHeight - sc.clientHeight));
      });
      const sq = new SearchQuery({
        search: query,
        caseSensitive,
        replace: replaceWith,
        literal: true,
      });
      updateCounts(view, sq);
    },
    [getView, query, caseSensitive, replaceWith],
  );

  const close = useCallback(() => {
    // Esc cierra y elimina los resaltados (CA9)
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
          placeholder="Buscar en la nota…"
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
        <button
          type="button"
          className={replaceOpen ? `${styles.iconButton} ${styles.active}` : styles.iconButton}
          title="Reemplazar"
          aria-pressed={replaceOpen}
          onClick={() => setReplaceOpen((v) => !v)}
        >
          <ChevronDown size={15} aria-hidden />
        </button>
        <button type="button" className={styles.iconButton} title="Cerrar (Esc)" onClick={close}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {replaceOpen && (
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
