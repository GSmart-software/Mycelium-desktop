"use client";

import { AlertTriangle, Code2, Columns3, Filter, Plus, Table2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  columnasDisponibles,
  arbolDeFiltro,
  condicionAplicable,
  construirTabla,
  filtroDeArbol,
  motivosNoEditable,
  OPERADORES_UI,
  OPS_DE_ARCHIVO,
  parsearBase,
  serializarBase,
  tituloColumna,
  type Base,
  type NodoFiltro,
  type NotaTabla,
  type Vista,
} from "@/lib/bases";
import { formatearFecha } from "@/lib/markdown";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
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
  const tabla = construirTabla(base, vista, notas, { ignorarFiltros: ignorar });

  /** Sustituye la vista activa y guarda el archivo entero. */
  const cambiarVista = (cambio: Partial<Vista>) => {
    const nueva: Base = {
      ...base,
      vistas: base.vistas.map((v, i) => (i === iVista ? { ...v, ...cambio } : v)),
    };
    void guardar(serializarBase(nueva));
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
            <table className={styles.tabla}>
              <thead>
                <tr>
                  {tabla.columnas.map((c) => (
                    <th key={c} scope="col">
                      {tituloColumna(base, c)}
                    </th>
                  ))}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tabla.filas.length === 0 && (
            <p className={styles.vacio}>Ninguna nota cumple los filtros de esta vista.</p>
          )}
        </>
      )}
    </div>
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
