"use client";

import { BookOpen, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buscarEnAyuda,
  esTemaHoja,
  idDeEnlace,
  PAGINA_INICIAL,
  paginaPorId,
  TEMAS,
  temaDe,
  vecinas,
} from "@/lib/ayuda/indice";
import type { PaginaAyuda } from "@/lib/ayuda/paginasGeneradas";
import { htmlDePagina } from "@/lib/ayuda/render";
import { addCodeCopyButtons } from "@/lib/codeCopy";
import { manejarClicDeEnlace } from "@/lib/enlacesExternos";
import { renderMermaidIn } from "@/lib/mermaid";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { useUiStore } from "@/stores/uiStore";
import styles from "./VentanaAyuda.module.css";

/**
 * La ayuda integrada (`FUN-L-27`): una «wiki» de Mycelium en una ventana sobre
 * la app, con el mismo lenguaje que el editor de snippets y Configuración. A la
 * izquierda, el buscador y el índice de temas y subtemas; a la derecha, la
 * página.
 *
 * Las páginas son Markdown del repo (`frontend/ayuda/`) que viajan con la app
 * en `lib/ayuda/paginasGeneradas.ts`, y se dibujan con el motor real de la
 * vista de lectura: los ejemplos no son capturas, son la sintaxis funcionando.
 */

/** La última página leída, para volver a ella al reabrir la ayuda. */
const CLAVE_ULTIMA = "mic-ayuda-ultima-pagina";

function leerUltima(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMA);
  } catch {
    return null;
  }
}

function guardarUltima(id: string) {
  try {
    localStorage.setItem(CLAVE_ULTIMA, id);
  } catch {
    /* sin almacenamiento: la próxima vez arranca en la inicial */
  }
}

/** La página con la que se abre: la pedida, si no la última, si no la inicial. */
function paginaDeInicio(pedida: string | null): string {
  return (paginaPorId(pedida) ?? paginaPorId(leerUltima()) ?? paginaPorId(PAGINA_INICIAL) ?? TEMAS[0].paginas[0]).id;
}

export function VentanaAyuda() {
  const pedida = useUiStore((s) => s.ayudaPagina);
  const cerrar = useUiStore((s) => s.cerrarAyuda);

  const [actual, setActual] = useState(() => paginaDeInicio(pedida));
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set([temaDe(actual)?.slug ?? ""]));
  const [consulta, setConsulta] = useState("");
  const [activo, setActivo] = useState(0);
  /** La fila del índice que es la parada de Tab (tabindex itinerante). */
  const [foco, setFoco] = useState<string | null>(null);

  const dialogoRef = useRef<HTMLDivElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const idLista = useId();

  useDialogoModal({ abierto: true, cerrar, dialogoRef });

  const pagina = paginaPorId(actual)!;
  const tema = temaDe(actual)!;
  const { anterior, siguiente } = vecinas(actual);

  /**
   * Ir a una página. `enfocar`: el foco pasa al título de la página nueva —al
   * seguir un enlace o «anterior/siguiente», que si no se queda en un botón
   * que ya no está—; desde el índice o el buscador se queda donde estaba.
   */
  const ir = useCallback((id: string, enfocar = false) => {
    if (!paginaPorId(id)) return;
    setActual(id);
    const slug = temaDe(id)?.slug;
    if (slug) setAbiertos((a) => (a.has(slug) ? a : new Set(a).add(slug)));
    if (enfocar) requestAnimationFrame(() => tituloRef.current?.focus());
  }, []);

  // Otra parte de la app pidió una página con la ayuda ya abierta. Se ajusta
  // durante el render (no en un efecto), como recomienda React para derivar
  // estado de una prop que cambia.
  const [pedidaVista, setPedidaVista] = useState(pedida);
  if (pedida !== pedidaVista) {
    setPedidaVista(pedida);
    const slug = pedida ? temaDe(pedida)?.slug : undefined;
    if (pedida && slug) {
      setActual(pedida);
      setAbiertos((a) => (a.has(slug) ? a : new Set(a).add(slug)));
    }
  }

  const html = useMemo(() => (pagina.pendiente ? "" : htmlDePagina(pagina.cuerpo)), [pagina]);

  // Al cambiar de página: arriba de todo, recordarla, y lo que el HTML no trae
  // hecho (Mermaid y el «Copiar» de los bloques de código), como en la nota.
  useEffect(() => {
    guardarUltima(actual);
    cuerpoRef.current?.scrollTo({ top: 0 });
    const cont = contenidoRef.current;
    if (!cont) return;
    addCodeCopyButtons(cont);
    void renderMermaidIn(cont);
  }, [actual, html]);

  const hallazgos = useMemo(() => buscarEnAyuda(consulta), [consulta]);
  useEffect(() => {
    listaRef.current?.querySelector(`[data-indice="${activo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activo]);

  /**
   * Clics dentro de la página. Un `ayuda:` navega acá; uno externo va al
   * navegador como en el resto de la app (`DEF-101`: nunca la webview). Lo
   * demás —un `[[enlace]]` o una `#etiqueta` de un ejemplo, una ruta— no lleva
   * a ningún lado desde la ayuda: los ejemplos se miran, no se navegan. Por lo
   * mismo, las casillas de tarea de un ejemplo no se marcan.
   */
  const onClicPagina = (e: React.MouseEvent<HTMLDivElement>) => {
    const objetivo = e.target as HTMLElement;
    if (objetivo instanceof HTMLInputElement && objetivo.type === "checkbox") {
      e.preventDefault();
      return;
    }
    const a = objetivo.closest("a");
    if (!a) return;
    const destino = idDeEnlace(a.getAttribute("href"));
    if (destino !== null) {
      e.preventDefault();
      ir(destino, true);
      return;
    }
    if (manejarClicDeEnlace(e)) return;
    e.preventDefault();
  };

  const alternarTema = (slug: string) =>
    setAbiertos((a) => {
      const n = new Set(a);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });

  /** Teclado del buscador: flechas por los resultados, Enter abre, Escape limpia. */
  const onTeclaBuscador = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && consulta) {
      e.stopPropagation();
      setConsulta("");
      return;
    }
    if (!hallazgos.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActivo((a) => (a + paso + hallazgos.length) % hallazgos.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      ir(hallazgos[activo].pagina.id);
    }
  };

  // Las filas del índice, aplanadas (patrón de árbol de WAI-ARIA con
  // `aria-level`, como el explorador): lo visible es lo que se recorre.
  type Fila =
    | { clave: string; nivel: 1; tipo: "tema"; slug: string; titulo: string; abierto: boolean }
    | { clave: string; nivel: 1 | 2; tipo: "pagina"; pagina: PaginaAyuda };
  const filas: Fila[] = [];
  for (const t of TEMAS) {
    if (esTemaHoja(t)) {
      filas.push({ clave: t.paginas[0].id, nivel: 1, tipo: "pagina", pagina: t.paginas[0] });
      continue;
    }
    const abierto = abiertos.has(t.slug);
    filas.push({ clave: `tema:${t.slug}`, nivel: 1, tipo: "tema", slug: t.slug, titulo: t.titulo, abierto });
    if (abierto) for (const p of t.paginas) filas.push({ clave: p.id, nivel: 2, tipo: "pagina", pagina: p });
  }
  const parada =
    filas.find((f) => f.clave === foco)?.clave ??
    filas.find((f) => f.clave === actual)?.clave ??
    `tema:${tema.slug}`;

  const hoja = esTemaHoja(tema);
  const idTitulo = "ayuda-titulo-pagina";

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div
        ref={dialogoRef}
        className={styles.ventana}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ayuda-titulo"
      >
        <header className={styles.cabecera}>
          <BookOpen size={17} aria-hidden className={styles.iconoTitulo} />
          <h2 id="ayuda-titulo" className={styles.titulo}>
            Ayuda de Mycelium
          </h2>
          <button type="button" className={styles.cerrar} aria-label="Cerrar la ayuda" onClick={cerrar}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className={styles.cuerpo}>
          <aside className={styles.indice}>
            <div className={styles.buscador}>
              <Search size={15} aria-hidden className={styles.lupa} />
              <input
                id="ayuda-buscar"
                className={styles.campoBusqueda}
                value={consulta}
                onChange={(e) => {
                  setConsulta(e.target.value);
                  setActivo(0);
                }}
                onKeyDown={onTeclaBuscador}
                placeholder="Buscar en la ayuda…"
                aria-label="Buscar en la ayuda"
                role="combobox"
                aria-expanded={consulta.trim() !== ""}
                aria-controls={idLista}
                aria-autocomplete="list"
                aria-activedescendant={hallazgos.length ? `${idLista}-${activo}` : undefined}
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {consulta.trim() ? (
              <ul ref={listaRef} id={idLista} role="listbox" aria-label="Resultados" className={styles.resultados}>
                {hallazgos.length === 0 ? (
                  <li className={styles.sinResultados} role="option" aria-selected="false" aria-disabled="true">
                    Ninguna página habla de eso.
                  </li>
                ) : (
                  hallazgos.map(({ pagina: p, fragmento }, i) => (
                    <li
                      key={p.id}
                      id={`${idLista}-${i}`}
                      role="option"
                      aria-selected={i === activo}
                      aria-current={p.id === actual ? "page" : undefined}
                      data-indice={i}
                      className={i === activo ? `${styles.resultado} ${styles.resultadoActivo}` : styles.resultado}
                      onPointerMove={() => i !== activo && setActivo(i)}
                      onClick={() => ir(p.id)}
                    >
                      <span className={styles.resultadoTitulo}>
                        {p.titulo}
                        {p.pendiente && <span className={styles.pronto}>Próximamente</span>}
                      </span>
                      <span className={styles.resultadoTema}>{p.tema}</span>
                      {fragmento && <span className={styles.resultadoFragmento}>{fragmento}</span>}
                    </li>
                  ))
                )}
              </ul>
            ) : (
              <div
                role="tree"
                aria-label="Temas de la ayuda"
                className={styles.arbol}
                onKeyDown={navegarArbol}
                onFocus={(e) => {
                  const clave = (e.target as HTMLElement).dataset.clave;
                  if (clave) setFoco(clave);
                }}
              >
                {filas.map((f) =>
                  f.tipo === "tema" ? (
                    <div
                      key={f.clave}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={f.abierto}
                      aria-selected={false}
                      data-clave={f.clave}
                      tabIndex={f.clave === parada ? 0 : -1}
                      className={styles.filaTema}
                      onClick={() => alternarTema(f.slug)}
                    >
                      <ChevronRight
                        size={14}
                        aria-hidden
                        className={f.abierto ? `${styles.chevron} ${styles.chevronAbierto}` : styles.chevron}
                      />
                      {f.titulo}
                    </div>
                  ) : (
                    <div
                      key={f.clave}
                      role="treeitem"
                      aria-level={f.nivel}
                      aria-selected={f.pagina.id === actual}
                      data-clave={f.clave}
                      tabIndex={f.clave === parada ? 0 : -1}
                      className={[
                        f.nivel === 1 ? styles.filaTema : styles.filaPagina,
                        f.pagina.id === actual ? styles.filaActual : "",
                        f.pagina.pendiente ? styles.filaPendiente : "",
                      ].join(" ")}
                      onClick={() => ir(f.pagina.id)}
                    >
                      {f.nivel === 1 && <span className={styles.chevronHueco} aria-hidden />}
                      <span className={styles.filaTexto}>{f.pagina.titulo}</span>
                      {f.pagina.pendiente && <span className={styles.pronto}>Pronto</span>}
                    </div>
                  ),
                )}
              </div>
            )}
          </aside>

          <div ref={cuerpoRef} className={styles.panel}>
            <article className={styles.pagina} aria-labelledby={idTitulo}>
              {!hoja && (
                <nav aria-label="Ubicación" className={styles.migas}>
                  <span>{tema.titulo}</span>
                  <ChevronRight size={12} aria-hidden />
                  <span aria-current="page">{pagina.titulo}</span>
                </nav>
              )}
              <h1 id={idTitulo} ref={tituloRef} tabIndex={-1} className={styles.tituloPagina}>
                {pagina.titulo}
              </h1>
              {pagina.pendiente ? (
                <p className={styles.vacia}>
                  Esta página todavía no está escrita. Llega en una próxima versión de Mycelium.
                </p>
              ) : (
                <div
                  ref={contenidoRef}
                  className={`mic-preview ${styles.contenido}`}
                  onClick={onClicPagina}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )}
              {(anterior || siguiente) && (
                <nav aria-label="Páginas vecinas" className={styles.vecinas}>
                  {anterior ? (
                    <button type="button" className={styles.vecina} onClick={() => ir(anterior.id, true)}>
                      <span className={styles.vecinaRotulo}>
                        <ChevronLeft size={13} aria-hidden /> Anterior
                      </span>
                      <span className={styles.vecinaTitulo}>{anterior.titulo}</span>
                    </button>
                  ) : (
                    <span />
                  )}
                  {siguiente && (
                    <button
                      type="button"
                      className={`${styles.vecina} ${styles.vecinaSiguiente}`}
                      onClick={() => ir(siguiente.id, true)}
                    >
                      <span className={styles.vecinaRotulo}>
                        Siguiente <ChevronRight size={13} aria-hidden />
                      </span>
                      <span className={styles.vecinaTitulo}>{siguiente.titulo}</span>
                    </button>
                  )}
                </nav>
              )}
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Teclado del índice (patrón de árbol de WAI-ARIA), el mismo que el del
 * explorador (`navegarArbol` de `ExplorerPanel`): flechas arriba y abajo,
 * Inicio y Fin; derecha abre el tema o baja a su primera página; izquierda lo
 * cierra o sube al tema; Enter y Espacio, lo mismo que el clic.
 */
function navegarArbol(e: React.KeyboardEvent<HTMLElement>) {
  const fila = e.target as HTMLElement;
  if (fila.getAttribute("role") !== "treeitem") return;
  const filas = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const i = filas.indexOf(fila);
  const nivel = Number(fila.getAttribute("aria-level"));
  const expandida = fila.getAttribute("aria-expanded");
  const ir = (j: number) => filas[Math.max(0, Math.min(filas.length - 1, j))]?.focus();

  switch (e.key) {
    case "ArrowDown":
      ir(i + 1);
      break;
    case "ArrowUp":
      ir(i - 1);
      break;
    case "Home":
      ir(0);
      break;
    case "End":
      ir(filas.length - 1);
      break;
    case "ArrowRight":
      if (expandida === "false") fila.click();
      else if (expandida === "true" && Number(filas[i + 1]?.getAttribute("aria-level")) === nivel + 1) ir(i + 1);
      break;
    case "ArrowLeft":
      if (expandida === "true") {
        fila.click();
      } else {
        for (let j = i - 1; j >= 0; j--) {
          if (Number(filas[j].getAttribute("aria-level")) === nivel - 1) {
            ir(j);
            break;
          }
        }
      }
      break;
    case "Enter":
    case " ":
      fila.click();
      break;
    default:
      return;
  }
  e.preventDefault();
}
