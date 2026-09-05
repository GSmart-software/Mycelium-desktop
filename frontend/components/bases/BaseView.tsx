"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Code2,
  Columns3,
  Filter,
  Plus,
  Search,
  Table2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "@/lib/api";
import {
  alternarOrden,
  columnasDisponibles,
  arbolDeFiltro,
  condicionAplicable,
  construirTabla,
  filtroDeArbol,
  motivosNoEditable,
  ordenDeColumna,
  OPERADORES_UI,
  OPS_DE_ARCHIVO,
  parsearBase,
  serializarBase,
  tituloColumna,
  type Base,
  type Busqueda,
  type NodoFiltro,
  type NotaTabla,
  type Vista,
} from "@/lib/bases";
import { formatearFecha } from "@/lib/markdown";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ANCHO_MIN, usePrefsVaultStore, usePrefVault } from "@/stores/prefsVaultStore";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { partirWikilink } from "@/lib/wikilinks";
import { GrupoFiltro } from "./FiltrosBuilder";
import styles from "./BaseView.module.css";

/**
 * Vista de un archivo `.base` (`FUN-L-03`): la tabla de notas que agrega, más
 * los controles para decidir qué notas entran y qué columnas se ven.
 *
 * La tabla es de **solo lectura** respecto de las notas: para cambiar el valor de
 * una propiedad se abre la nota. Lo que sí se edita acá es la BASE — sus filtros
 * y sus columnas—, que es la definición de la consulta.
 *
 * > [!important] Editar por UI solo si el archivo se entiende entero
 * > Los controles regeneran el YAML desde el modelo. Si el archivo trae algo que
 * > Mycelium no modela (`formulas`, `groupBy`, un filtro anidado), regenerarlo lo
 * > borraría: el usuario perdería trabajo por haber pulsado un botón. En ese caso
 * > los controles se deshabilitan con el motivo y queda la edición de la fuente,
 * > que no reescribe nada que no haya escrito el usuario.
 */
export function BaseView({ notaId }: { notaId: string }) {
  const router = useRouter();
  const [fuente, setFuente] = useState<string | null>(null);
  const [notas, setNotas] = useState<NotaTabla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [vistaActiva, setVistaActiva] = useState(0);
  const [modo, setModo] = useState<"tabla" | "fuente">("tabla");
  const [panel, setPanel] = useState<null | "columnas" | "filtros">(null);
  const [borrador, setBorrador] = useState("");
  /** Vistas en las que el usuario pidió ver las filas pese al filtro roto. */
  const [sinFiltrar, setSinFiltrar] = useState<Record<number, boolean>>({});
  // Lo que se busca DENTRO de la tabla (`FUN-S-14`). No se guarda en el archivo
  // ni sobrevive a cerrar la pestaña: no define la consulta, solo mira lo que
  // esta ya devolvió.
  const [busqueda, setBusqueda] = useState<Busqueda>({ texto: "", exacta: false });
  // Anchos de columna (`FUN-M-25`). Se leen del vault y se escriben ahí; durante
  // el arrastre NO pasan por React —se tocan los `<col>` directamente— para no
  // rehacer la tabla entera en cada píxel.
  const anchosTodos = usePrefVault("anchosTabla");
  const anchos = anchosTodos[notaId];
  const tablaRef = useRef<HTMLTableElement>(null);
  const filaCabeceraRef = useRef<HTMLTableRowElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const vaultId = useAuthStore((s) => s.vaults[0]?.id) ?? null;

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void (async () => {
      try {
        const token = useAuthStore.getState().accessToken;
        const [contenido, tabla] = await Promise.all([
          api<{ contenido: string }>(`/notas/${encodeURIComponent(notaId)}/contenido`, { token }),
          vaultId
            ? api<{ notas: NotaTabla[] }>(`/vaults/${vaultId}/tabla`, { token })
            : Promise.resolve({ notas: [] as NotaTabla[] }),
        ]);
        if (cancelado) return;
        setFuente(contenido.contenido ?? "");
        setBorrador(contenido.contenido ?? "");
        setNotas(tabla.notas);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [notaId, vaultId]);

  // Cerrar el panel al pulsar fuera, como el resto de los menús de la app.
  useEffect(() => {
    if (panel === null) return;
    function fuera(e: PointerEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setPanel(null);
    }
    window.addEventListener("pointerdown", fuera);
    return () => window.removeEventListener("pointerdown", fuera);
  }, [panel]);

  const parseado = useMemo((): { base: Base } | { errorYaml: string } | null => {
    if (fuente === null) return null;
    try {
      return { base: parsearBase(fuente) };
    } catch (e) {
      return { errorYaml: e instanceof Error ? e.message : String(e) };
    }
  }, [fuente]);

  /** Escribe el archivo y refresca desde lo escrito. */
  const guardar = async (texto: string) => {
    setGuardando(true);
    setError(null);
    try {
      await api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
        method: "PUT",
        token: useAuthStore.getState().accessToken,
        body: { contenido: texto },
      });
      setFuente(texto);
      setBorrador(texto);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  if (error !== null && fuente === null) {
    return <p className={styles.aviso}>No se pudo cargar la base: {error}</p>;
  }
  if (parseado === null || notas === null) {
    return <p className={styles.cargando}>Cargando la base…</p>;
  }

  // ── El YAML no parsea: solo queda la fuente ────────────────────────────────
  if ("errorYaml" in parseado) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error} role="alert">
          <AlertTriangle size={15} aria-hidden />
          <div>
            <p className={styles.errorTitulo}>Este archivo no se entiende como base.</p>
            <p className={styles.errorDetalle}>{parseado.errorYaml}</p>
          </div>
        </div>
        <EditorFuente
          borrador={borrador}
          setBorrador={setBorrador}
          onGuardar={() => void guardar(borrador)}
          guardando={guardando}
          sucio={borrador !== fuente}
        />
      </div>
    );
  }

  const { base } = parseado;
  const vista: Vista = base.vistas[Math.min(vistaActiva, base.vistas.length - 1)];
  const iVista = Math.min(vistaActiva, base.vistas.length - 1);
  const bloqueos = motivosNoEditable(base);
  const editable = bloqueos.length === 0;
  // El filtro como ÁRBOL (`FUN-M-27`): un grupo con condiciones y otros grupos,
  // que es la forma que el motor ya manejaba y la UI no sabía mostrar.
  const arbolFiltros = arbolDeFiltro(vista.filtros);
  // Cuántas condiciones hay en total, para el contador del botón: cuenta las de
  // los grupos anidados, no solo las del primer nivel.
  const totalCondiciones = arbolFiltros === null ? 0 : contarCondiciones(arbolFiltros);
  const columnas = columnasDisponibles(notas);
  const ignorar = sinFiltrar[iVista] === true;
  const tabla = construirTabla(base, vista, notas, {
    ignorarFiltros: ignorar,
    busqueda: busqueda.texto.trim() === "" ? undefined : busqueda,
  });

  /** Sustituye la vista activa y guarda el archivo entero. */
  const cambiarVista = (cambio: Partial<Vista>) => {
    const nueva: Base = {
      ...base,
      vistas: base.vistas.map((v, i) => (i === iVista ? { ...v, ...cambio } : v)),
    };
    void guardar(serializarBase(nueva));
  };

  // Las columnas que se están dibujando; vacío si la tabla no se pudo construir.
  const refsColumnas = tabla.ok ? tabla.columnas : [];

  /** Guarda (o borra, con `null`) los anchos de ESTA base, sin tocar los demás. */
  const guardarAnchos = (nuevos: Record<string, number> | null) => {
    const copia = { ...anchosTodos };
    if (nuevos === null) delete copia[notaId];
    else copia[notaId] = nuevos;
    usePrefsVaultStore.getState().set("anchosTabla", copia);
  };

  /**
   * Mide los `th` tal como se ven ahora.
   *
   * Es lo que permite que el primer arrastre no dé un salto: la tabla venía con
   * el reparto automático del navegador y hay que congelarla **en ese** reparto
   * antes de empezar a mover un borde.
   */
  const medirAnchos = (): Record<string, number> => {
    const celdas = filaCabeceraRef.current?.children;
    const medidos: Record<string, number> = {};
    refsColumnas.forEach((c, i) => {
      const el = celdas?.[i] as HTMLElement | undefined;
      if (el) medidos[c] = Math.max(ANCHO_MIN, Math.round(el.getBoundingClientRect().width));
    });
    return medidos;
  };

  /**
   * Arrastrar el borde derecho de una columna (`FUN-M-25`).
   *
   * Mientras dura el arrastre se escribe **directamente en el `<col>`**: pasar
   * cada píxel por el estado volvería a dibujar todas las filas de la tabla en
   * cada movimiento del puntero. Al soltar se guarda una sola vez, y ahí sí
   * React vuelve a mandar.
   */
  const empezarRedimension = (e: ReactPointerEvent, ref: string) => {
    const cols = tablaRef.current?.querySelectorAll("col");
    const i = refsColumnas.indexOf(ref);
    if (!cols || i === -1) return;

    // Lo medido rellena los huecos; lo guardado manda donde exista.
    const partida = { ...medirAnchos(), ...(anchos ?? {}) };
    // Congelar el reparto actual antes de mover nada.
    if (tablaRef.current) {
      tablaRef.current.style.tableLayout = "fixed";
      tablaRef.current.style.width = "max-content";
    }
    refsColumnas.forEach((c, j) => {
      const col = cols[j] as HTMLElement | undefined;
      if (col && partida[c]) col.style.width = `${partida[c]}px`;
    });

    const inicial = partida[ref] ?? ANCHO_MIN;
    const x0 = e.clientX;
    let ultimo = inicial;
    const objetivo = cols[i] as HTMLElement;

    const mover = (ev: PointerEvent) => {
      ultimo = Math.max(ANCHO_MIN, Math.round(inicial + ev.clientX - x0));
      objetivo.style.width = `${ultimo}px`;
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      document.body.classList.remove("mic-redimensionando");
      guardarAnchos({ ...partida, [ref]: ultimo });
    };
    // El cursor va en el `body`: durante el arrastre el puntero se sale del
    // tirador constantemente, y sin esto parpadearía entre flecha y col-resize.
    document.body.classList.add("mic-redimensionando");
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  const abrir = (id: string) => {
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.cabecera} ref={panelRef}>
        <Table2 size={15} aria-hidden />
        {base.vistas.length > 1 ? (
          <div className={styles.vistas} role="tablist">
            {base.vistas.map((v, i) => (
              <button
                key={`${v.nombre}-${i}`}
                type="button"
                role="tab"
                aria-selected={i === iVista}
                className={i === iVista ? styles.vistaActiva : styles.vista}
                onClick={() => setVistaActiva(i)}
              >
                {v.nombre}
              </button>
            ))}
          </div>
        ) : (
          <span className={styles.titulo}>{vista.nombre}</span>
        )}

        {modo === "tabla" && tabla.ok && (
          <BuscadorTabla valor={busqueda} onCambio={setBusqueda} />
        )}

        <div className={styles.controles}>
          <button
            type="button"
            className={panel === "filtros" ? styles.controlActivo : styles.control}
            disabled={modo === "fuente" || !editable}
            title={editable ? "Filtrar qué notas entran" : bloqueos[0]}
            aria-expanded={panel === "filtros"}
            onClick={() => setPanel((p) => (p === "filtros" ? null : "filtros"))}
          >
            <Filter size={14} aria-hidden /> Filtros
            {totalCondiciones > 0 && (
              <span className={styles.contador}>{totalCondiciones}</span>
            )}
          </button>
          <button
            type="button"
            className={panel === "columnas" ? styles.controlActivo : styles.control}
            disabled={modo === "fuente" || !editable}
            title={editable ? "Elegir las columnas" : bloqueos[0]}
            aria-expanded={panel === "columnas"}
            onClick={() => setPanel((p) => (p === "columnas" ? null : "columnas"))}
          >
            <Columns3 size={14} aria-hidden /> Columnas
          </button>
          <button
            type="button"
            className={modo === "fuente" ? styles.controlActivo : styles.control}
            title="Ver y editar el YAML del archivo"
            onClick={() => {
              setPanel(null);
              setModo((m) => (m === "fuente" ? "tabla" : "fuente"));
            }}
          >
            <Code2 size={14} aria-hidden /> Fuente
          </button>
        </div>

        {modo === "tabla" && tabla.ok && (
          <span className={styles.recuento}>
            {tabla.total} {tabla.total === 1 ? "nota" : "notas"}
            {tabla.recortadas > 0 && ` · ${tabla.recortadas} ocultas por el límite`}
            {tabla.ocultasPorBusqueda > 0 &&
              ` · ${tabla.ocultasPorBusqueda} no coinciden con la búsqueda`}
          </span>
        )}

        {panel === "filtros" && (
          <PanelFiltros
            arbol={arbolFiltros}
            columnas={columnas}
            onCambio={(siguiente) => cambiarVista({ filtros: filtroDeArbol(siguiente) })}
          />
        )}
        {panel === "columnas" && (
          <PanelColumnas
            columnas={columnas}
            elegidas={vista.columnas.length > 0 ? vista.columnas : ["file.name"]}
            base={base}
            onCambio={(cols) => cambiarVista({ columnas: cols })}
          />
        )}
      </header>

      {!editable && modo === "tabla" && (
        <p className={styles.aviso}>
          Los filtros y las columnas se editan acá solo si Mycelium entiende el archivo
          entero, y en este no: {bloqueos[0]}. Regenerar el YAML lo borraría, así que se
          edita desde <strong>Fuente</strong>.
        </p>
      )}

      {error !== null && <p className={styles.avisoFuerte}>No se pudo guardar: {error}</p>}

      {modo === "fuente" ? (
        <EditorFuente
          borrador={borrador}
          setBorrador={setBorrador}
          onGuardar={() => void guardar(borrador)}
          guardando={guardando}
          sucio={borrador !== fuente}
        />
      ) : !tabla.ok ? (
        <div className={styles.error} role="alert">
          <AlertTriangle size={15} aria-hidden />
          <div>
            <p className={styles.errorTitulo}>{tabla.motivo}</p>
            {tabla.expresion !== null && (
              <pre className={styles.expresion}>
                <code>{tabla.expresion}</code>
              </pre>
            )}
            {/* No se muestra una tabla filtrada A MEDIAS haciéndola pasar por
                completa: ver las filas sin filtrar es una decisión del usuario,
                y queda dicho arriba que el filtro no se aplicó. */}
            <button
              type="button"
              className={styles.botonSecundario}
              onClick={() => setSinFiltrar((s) => ({ ...s, [iVista]: true }))}
            >
              Ver todas las notas, sin filtrar
            </button>
          </div>
        </div>
      ) : (
        <>
          {ignorar && (
            <p className={styles.avisoFuerte} role="status">
              <AlertTriangle size={13} aria-hidden /> El filtro <strong>no se está
              aplicando</strong>: estas son todas las notas del vault.
            </p>
          )}
          <div className={styles.scroll}>
            {/* Con anchos guardados la tabla pasa a `fixed` y su ancho lo deciden
                las columnas; sin ellos se deja el reparto automático de siempre,
                para que una base que nadie ajustó se vea igual que antes. */}
            <table
              ref={tablaRef}
              className={styles.tabla}
              style={
                anchos ? { tableLayout: "fixed", width: "max-content", minWidth: "100%" } : undefined
              }
            >
              <colgroup>
                {tabla.columnas.map((c) => (
                  // En `fixed`, una columna sin ancho se reparte el sobrante y
                  // el resultado depende de cuántas haya. Si la tabla está
                  // ajustada, TODAS llevan ancho: las que nadie tocó —una
                  // columna agregada después— caen en el de partida.
                  <col
                    key={c}
                    style={anchos ? { width: anchos[c] ?? ANCHO_NUEVA_COLUMNA } : undefined}
                  />
                ))}
                {/* La columna de relleno. En `fixed`, una columna SIN ancho se
                    queda con el sobrante, así que es ella la que absorbe el
                    hueco cuando las demás no llenan el ancho disponible. Sin
                    esto habría que estirar las reales, y el ancho que el
                    usuario eligió dejaría de ser el que se ve. */}
                {anchos && <col />}
              </colgroup>
              <thead>
                <tr ref={filaCabeceraRef}>
                  {tabla.columnas.map((c) => (
                    <CabeceraColumna
                      key={c}
                      titulo={tituloColumna(base, c)}
                      orden={ordenDeColumna(vista.orden, c)}
                      criterios={vista.orden.length}
                      // Ordenar reescribe el `sort` del archivo, así que sigue
                      // la misma regla que los filtros y las columnas: si el
                      // archivo no se entiende entero, no se toca.
                      motivoBloqueo={editable ? null : bloqueos[0]}
                      onOrdenar={(acumular) =>
                        cambiarVista({ orden: alternarOrden(vista.orden, c, acumular) })
                      }
                      onRedimensionar={(e) => empezarRedimension(e, c)}
                      onRestablecer={() => guardarAnchos(null)}
                    />
                  ))}
                  {anchos && <th aria-hidden className={styles.relleno} />}
                </tr>
              </thead>
              <tbody>
                {tabla.filas.map(({ nota, celdas }) => (
                  <tr
                    key={nota.id}
                    tabIndex={0}
                    onClick={() => abrir(nota.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") abrir(nota.id);
                    }}
                  >
                    {celdas.map((valores, i) => (
                      <td key={tabla.columnas[i]}>
                        <Celda
                          columna={tabla.columnas[i]}
                          valores={valores}
                          nota={nota}
                          onAbrir={abrir}
                        />
                      </td>
                    ))}
                    {anchos && <td aria-hidden className={styles.relleno} />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tabla.filas.length === 0 &&
            (tabla.ocultasPorBusqueda > 0 ? (
              // Decir «ninguna cumple los filtros» acá seria mentir: los filtros
              // sí devolvieron notas, es la búsqueda la que no encuentra. Con el
              // botón para vaciarla al lado, que es lo que hay que hacer.
              <p className={styles.vacio}>
                Ninguna de las {tabla.ocultasPorBusqueda} filas coincide con{" "}
                <strong>«{busqueda.texto.trim()}»</strong>.{" "}
                <button
                  type="button"
                  className={styles.enlaceAccion}
                  onClick={() => setBusqueda((b) => ({ ...b, texto: "" }))}
                >
                  Vaciar la búsqueda
                </button>
              </p>
            ) : (
              <p className={styles.vacio}>Ninguna nota cumple los filtros de esta vista.</p>
            ))}
        </>
      )}
    </div>
  );
}

/**
 * Buscar una fila dentro de la tabla (`FUN-S-14`).
 *
 * No es un filtro y no se comporta como uno: los filtros deciden **qué notas
 * entran** y viven en el archivo; esto solo mira lo que ya entró y se va con la
 * pestaña. Por eso está fuera del panel de filtros y no escribe nada.
 *
 * > [!note] Parcial y exacta se eligen con un interruptor, no con `*`
 * > El enunciado hablaba de `*XYZ*`. Un interruptor se ve —la sintaxis con
 * > comodines hay que saberla— y además deja buscar un asterisco literal, que
 * > con la otra forma sería imposible.
 */
function BuscadorTabla({
  valor,
  onCambio,
}: {
  valor: Busqueda;
  onCambio: (b: Busqueda) => void;
}) {
  return (
    <div className={styles.buscarFila}>
      <Search size={13} aria-hidden />
      <input
        className={styles.buscarInput}
        value={valor.texto}
        placeholder="Buscar en la tabla…"
        aria-label="Buscar dentro de la tabla"
        spellCheck={false}
        onChange={(e) => onCambio({ ...valor, texto: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape" && valor.texto !== "") {
            e.preventDefault();
            onCambio({ ...valor, texto: "" });
          }
        }}
      />
      {valor.texto !== "" && (
        <button
          type="button"
          className={styles.buscarLimpiar}
          aria-label="Vaciar la búsqueda"
          title="Vaciar"
          onClick={() => onCambio({ ...valor, texto: "" })}
        >
          <X size={12} aria-hidden />
        </button>
      )}
      <button
        type="button"
        className={valor.exacta ? styles.buscarModoActivo : styles.buscarModo}
        aria-pressed={valor.exacta}
        title={
          valor.exacta
            ? "Coincidencia exacta: el valor de la celda es exactamente esto"
            : "Coincidencia parcial: el valor de la celda contiene esto"
        }
        onClick={() => onCambio({ ...valor, exacta: !valor.exacta })}
      >
        exacta
      </button>
    </div>
  );
}

/**
 * Cabecera de una columna, que además ordena por ella (`FUN-S-15`).
 *
 * El clic recorre `ascendente → descendente → sin orden`; <kbd>Shift</kbd>+clic
 * **suma** la columna a las que ya ordenan en vez de reemplazarlas, porque el
 * formato admite varios criterios y un clic que siempre los borra dejaría un
 * `sort` de dos columnas imposible de rehacer desde acá.
 *
 * Cuando hay más de un criterio, cada flecha lleva su número de orden: sin él,
 * dos flechas parecen dos órdenes compitiendo en vez de uno detrás del otro.
 */
function CabeceraColumna({
  titulo,
  orden,
  criterios,
  motivoBloqueo,
  onOrdenar,
  onRedimensionar,
  onRestablecer,
}: {
  titulo: string;
  orden: { descendente: boolean; posicion: number } | null;
  criterios: number;
  motivoBloqueo: string | null;
  onOrdenar: (acumular: boolean) => void;
  onRedimensionar: (e: ReactPointerEvent) => void;
  onRestablecer: () => void;
}) {
  const sentido = orden === null ? "none" : orden.descendente ? "descending" : "ascending";
  const Flecha = orden?.descendente ? ArrowDown : ArrowUp;

  return (
    <th scope="col" aria-sort={sentido} className={styles.thOrdenable}>
      <button
        type="button"
        className={orden === null ? styles.cabeceraBoton : styles.cabeceraBotonActiva}
        disabled={motivoBloqueo !== null}
        title={
          motivoBloqueo !== null
            ? `No se puede ordenar: ${motivoBloqueo}`
            : "Ordenar por esta columna · Shift+clic para ordenar también por ella"
        }
        onClick={(e) => onOrdenar(e.shiftKey)}
      >
        <span className={styles.cabeceraTexto}>{titulo}</span>
        {orden !== null && (
          <span className={styles.ordenMarca} aria-hidden>
            <Flecha size={12} />
            {criterios > 1 && <span className={styles.ordenPos}>{orden.posicion}</span>}
          </span>
        )}
      </button>
      {/* El tirador del ancho (`FUN-M-25`). Va fuera del botón y frena el evento
          para que arrastrar un borde no ordene la tabla de paso. No es
          focusable: no aporta nada que el teclado pueda usar, y el ancho de una
          columna no es información — se restablece con doble clic. */}
      <span
        className={styles.tirador}
        role="presentation"
        title="Arrastrar para cambiar el ancho · Doble clic para volver a los automáticos"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRedimensionar(e);
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onRestablecer();
        }}
      />
    </th>
  );
}

/** Editor del YAML crudo. No reescribe nada: guarda exactamente lo que se ve. */
function EditorFuente({
  borrador,
  setBorrador,
  onGuardar,
  guardando,
  sucio,
}: {
  borrador: string;
  setBorrador: (v: string) => void;
  onGuardar: () => void;
  guardando: boolean;
  sucio: boolean;
}) {
  return (
    <div className={styles.fuente}>
      <textarea
        className={styles.textarea}
        value={borrador}
        spellCheck={false}
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onGuardar();
          }
        }}
        aria-label="Fuente YAML de la base"
      />
      <div className={styles.fuenteAcciones}>
        <span className={styles.fuenteNota}>
          Formato <code>.base</code> de Obsidian. <kbd>Ctrl</kbd>+<kbd>S</kbd> guarda.
        </span>
        <button
          type="button"
          className={styles.botonPrimario}
          disabled={guardando || !sucio}
          onClick={onGuardar}
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Ancho de una columna que aparece en una tabla ya ajustada (`FUN-M-25`).
 *
 * No se mide: cuando se dibuja por primera vez la tabla ya está en `fixed`, así
 * que no hay un ancho natural que medir. Es un punto de partida razonable, y
 * arrastrarla una vez lo reemplaza.
 */
const ANCHO_NUEVA_COLUMNA = 180;

/** Cuántas condiciones tiene el árbol, incluidas las de los grupos anidados. */
function contarCondiciones(nodo: NodoFiltro): number {
  return nodo.tipo === "cond" ? 1 : nodo.hijos.reduce((t: number, h: NodoFiltro) => t + contarCondiciones(h), 0);
}

/**
 * El panel de filtros. Si el archivo trae algo que el constructor no sabe
 * representar, se dice y se manda a **Fuente** en vez de mostrar una version
 * simplificada que al guardar destruiria el filtro real.
 */
function PanelFiltros({
  arbol,
  columnas,
  onCambio,
}: {
  arbol: NodoFiltro | null;
  columnas: { ref: string; grupo: string }[];
  onCambio: (siguiente: NodoFiltro) => void;
}) {
  if (arbol === null || arbol.tipo !== "grupo") {
    return (
      <div className={styles.panel}>
        <p className={styles.panelNota}>
          Este filtro usa expresiones que el constructor no sabe representar.
          Mostrarlo simplificado haría que guardar <strong>destruyera</strong> el
          filtro real, así que se edita desde <strong>Fuente</strong>.
        </p>
      </div>
    );
  }
  return <FiltrosEditables arbol={arbol} columnas={columnas} onCambio={onCambio} />;
}

/**
 * El constructor con estado local.
 *
 * El borrador sigue al archivo cuando este cambia POR FUERA, pero NO cuando solo
 * devuelve el eco de nuestro propio guardado (`DEF-080`): lo que está a medias
 * no se escribe, así que volvería sin ello y el reset se lo llevaría puesto. Se
 * compara durante el render y no en un efecto, para no pintar un fotograma con
 * el valor viejo.
 */
function FiltrosEditables({
  arbol,
  columnas,
  onCambio,
}: {
  arbol: Extract<NodoFiltro, { tipo: "grupo" }>;
  columnas: { ref: string; grupo: string }[];
  onCambio: (siguiente: NodoFiltro) => void;
}) {
  const [borrador, setBorrador] = useState<NodoFiltro>(arbol);
  const [visto, setVisto] = useState<NodoFiltro>(arbol);
  if (visto !== arbol) {
    setVisto(arbol);
    if (!mismoFiltro(borrador, arbol)) setBorrador(arbol);
  }

  const cambiar = (siguiente: NodoFiltro) => {
    setBorrador(siguiente);
    onCambio(siguiente);
  };

  return (
    <div className={styles.panel}>
      <GrupoFiltro
        nodo={borrador as Extract<NodoFiltro, { tipo: "grupo" }>}
        campos={columnas}
        raiz
        onCambio={cambiar}
      />
    </div>
  );
}

/**
 * ¿El archivo dice lo mismo que la parte COMPLETA del borrador? (`DEF-080`)
 *
 * Se compara lo que el borrador PRODUCIRÍA con lo que el archivo trajo: si
 * coinciden, lo que llegó es el eco del propio guardado y no hay novedad que
 * incorporar.
 */
function mismoFiltro(borrador: NodoFiltro, delArchivo: NodoFiltro): boolean {
  return JSON.stringify(filtroDeArbol(borrador)) === JSON.stringify(filtroDeArbol(delArchivo));
}

/** Selector de columnas: el orden de la lista es el orden de la tabla. */
function PanelColumnas({
  columnas,
  elegidas,
  base,
  onCambio,
}: {
  columnas: { ref: string; grupo: string }[];
  elegidas: string[];
  base: Base;
  onCambio: (cols: string[]) => void;
}) {
  const grupos = [...new Set(columnas.map((c) => c.grupo))];
  return (
    <div className={styles.panel}>
      <p className={styles.panelNota}>
        Se muestran en el orden en que se marcan. La primera es el nombre de la nota, y es
        la que abre el archivo.
      </p>
      {grupos.map((grupo) => (
        <div key={grupo}>
          <span className={styles.panelTitulo}>{grupo}</span>
          {columnas
            .filter((c) => c.grupo === grupo)
            .map((c) => {
              const marcada = elegidas.includes(c.ref);
              return (
                <label key={c.ref} className={styles.opcion}>
                  <input
                    type="checkbox"
                    checked={marcada}
                    onChange={() =>
                      onCambio(
                        marcada
                          ? elegidas.filter((x) => x !== c.ref)
                          : [...elegidas, c.ref],
                      )
                    }
                  />
                  <span>{tituloColumna(base, c.ref)}</span>
                  <code className={styles.opcionRef}>{c.ref}</code>
                </label>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/** `[[destino]]` o `![[destino]]` dentro del valor de una propiedad. */
const RE_WIKILINK_CELDA = /!?\[\[([^[\]]+)\]\]/g;

/**
 * El texto de una celda, con sus `[[wikilinks]]` como enlaces (`DEF-071`).
 *
 * Antes salían como texto plano —corchetes incluidos— así que desde una tabla
 * no se podía navegar, aunque el enlace fuera perfectamente válido y el grafo
 * lo contara.
 *
 * El clic **no puede burbujear**: la fila entera abre su nota, así que sin
 * `stopPropagation` pulsar un enlace abriría la nota de la FILA en vez de la
 * enlazada — que es justo la confusión que este arreglo viene a quitar.
 *
 * Un destino que no existe se muestra atenuado y sin enlazar, con el mismo
 * criterio que el editor: se ve que la referencia está, y que no llega a nada.
 */
function TextoDeCelda({ texto, onAbrir }: { texto: string; onAbrir: (id: string) => void }) {
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);

  const partes: React.ReactNode[] = [];
  let desde = 0;
  RE_WIKILINK_CELDA.lastIndex = 0;
  for (let m = RE_WIKILINK_CELDA.exec(texto); m !== null; m = RE_WIKILINK_CELDA.exec(texto)) {
    if (m.index > desde) partes.push(texto.slice(desde, m.index));
    // El mismo partidor que el resto de la app: la barra del alias puede venir
    // escapada si el enlace vive en una tabla markdown (`DEF-045`).
    const { destino, etiqueta } = partirWikilink(m[1]);
    const nota = resolveWikilink(destino, notas, carpetas);
    partes.push(
      nota === undefined ? (
        <span key={m.index} className={styles.enlaceRoto} title={`No existe «${destino}»`}>
          {etiqueta}
        </span>
      ) : (
        <a
          key={m.index}
          className={styles.enlace}
          href={`/workspace?note=${encodeURIComponent(nota.id)}`}
          title={destino}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAbrir(nota.id);
          }}
        >
          {etiqueta}
        </a>
      ),
    );
    desde = m.index + m[0].length;
  }
  if (partes.length === 0) return <>{texto}</>;
  if (desde < texto.length) partes.push(texto.slice(desde));
  return <>{partes}</>;
}

/**
 * Una celda. Usa el mismo lenguaje visual que la tarjeta de propiedades de
 * `FUN-M-04` —píldoras para las listas, fechas en formato local— para que un
 * valor se vea igual acá que dentro de su nota.
 */
function Celda({
  columna,
  valores,
  nota,
  onAbrir,
}: {
  columna: string;
  valores: string[] | undefined;
  nota: NotaTabla;
  onAbrir: (id: string) => void;
}) {
  if (valores === undefined || valores.length === 0) {
    return <span className={styles.vacia}>—</span>;
  }
  if (columna === "file.ctime" || columna === "file.mtime") {
    return <span className={styles.fecha}>{formatearFecha(valores[0])}</span>;
  }
  if (columna === "file.size") {
    return <span className={styles.numero}>{(nota.size / 1024).toFixed(1)} KB</span>;
  }
  if (valores.length > 1 || columna === "file.tags") {
    return (
      <span className={styles.pildoras}>
        {valores.map((v) => (
          <span key={v} className={styles.pildora}>
            {/* También en las píldoras: una propiedad de lista puede enlazar. */}
            <TextoDeCelda texto={v} onAbrir={onAbrir} />
          </span>
        ))}
      </span>
    );
  }
  const unico = valores[0];
  if (unico === "true" || unico === "false") {
    return <input type="checkbox" checked={unico === "true"} disabled aria-label={columna} />;
  }
  if (/^-?\d+(\.\d+)?$/.test(unico)) {
    return <span className={styles.numero}>{unico}</span>;
  }
  return <TextoDeCelda texto={unico} onAbrir={onAbrir} />;
}
