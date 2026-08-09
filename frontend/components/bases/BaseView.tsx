"use client";

import { AlertTriangle, Code2, Columns3, Filter, Plus, Table2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  columnasDisponibles,
  condicionesPlanas,
  construirTabla,
  filtroDeCondiciones,
  motivosNoEditable,
  OPERADORES_UI,
  OPS_DE_ARCHIVO,
  parsearBase,
  serializarBase,
  tituloColumna,
  type Base,
  type Condicion,
  type NotaTabla,
  type Vista,
} from "@/lib/bases";
import { formatearFecha } from "@/lib/markdown";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
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
  const planas = condicionesPlanas(vista.filtros);
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
            {planas !== null && planas.condiciones.length > 0 && (
              <span className={styles.contador}>{planas.condiciones.length}</span>
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
            planas={planas}
            columnas={columnas}
            onCambio={(combinador, condiciones) =>
              cambiarVista({ filtros: filtroDeCondiciones(combinador, condiciones) })
            }
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
                        <Celda columna={tabla.columnas[i]} valores={valores} nota={nota} />
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

/**
 * Constructor de filtros. Solo aparece si el filtro actual se puede representar
 * como una lista plana: si es anidado, mostrar una versión simplificada haría que
 * guardar destruyera el filtro real, así que se dice y se manda a la fuente.
 */
function PanelFiltros({
  planas,
  columnas,
  onCambio,
}: {
  planas: { combinador: "and" | "or"; condiciones: Condicion[] } | null;
  columnas: { ref: string; grupo: string }[];
  onCambio: (combinador: "and" | "or", condiciones: Condicion[]) => void;
}) {
  if (planas === null) {
    return (
      <div className={styles.panel}>
        <p className={styles.panelNota}>
          Este filtro combina grupos anidados, y el constructor solo sabe mostrar una lista
          de condiciones. Enseñarlo simplificado haría que guardar <strong>destruyera</strong>{" "}
          el filtro real, así que se edita desde <strong>Fuente</strong>.
        </p>
      </div>
    );
  }

  return <FiltrosEditables planas={planas} columnas={columnas} onCambio={onCambio} />;
}

/**
 * El constructor propiamente dicho, con estado local.
 *
 * Lo escrito se mantiene acá y **solo se guarda al confirmar**: los desplegables
 * al cambiar, y el campo de texto al salir de él o con Enter. Escribir el archivo
 * en cada tecla haría un `PUT` por carácter y, peor, reparsearía el YAML a media
 * palabra: al escribir «activo» la tabla se recalcularía contra «a», «ac», «act»…
 * Es el mismo patrón de borrador + `onBlur` que ya usan Configuración → Vault y
 * el ancho de tabulación.
 */
function FiltrosEditables({
  planas,
  columnas,
  onCambio,
}: {
  planas: { combinador: "and" | "or"; condiciones: Condicion[] };
  columnas: { ref: string; grupo: string }[];
  onCambio: (combinador: "and" | "or", condiciones: Condicion[]) => void;
}) {
  const [combinador, setCombinador] = useState(planas.combinador);
  const [condiciones, setCondiciones] = useState(planas.condiciones);

  // El borrador sigue al archivo cuando este cambia por fuera (otra edición, o
  // el guardado que acabamos de provocar). Se compara DURANTE el render, no en
  // un efecto, para no pintar un fotograma con el valor viejo.
  const [visto, setVisto] = useState(planas);
  if (visto !== planas) {
    setVisto(planas);
    setCombinador(planas.combinador);
    setCondiciones(planas.condiciones);
  }

  /** Cambia el borrador y confirma (para los controles discretos). */
  const confirmar = (comb: "and" | "or", cs: Condicion[]) => {
    setCombinador(comb);
    setCondiciones(cs);
    onCambio(comb, cs);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelCabecera}>
        <span className={styles.panelTitulo}>Mostrar las notas que cumplen</span>
        <select
          className={styles.select}
          value={combinador}
          onChange={(e) => confirmar(e.target.value as "and" | "or", condiciones)}
        >
          <option value="and">todas las condiciones</option>
          <option value="or">alguna condición</option>
        </select>
      </div>

      {condiciones.length === 0 && (
        <p className={styles.panelNota}>Sin filtros: entran todas las notas del vault.</p>
      )}

      {condiciones.map((c, i) => {
        const meta = OPERADORES_UI.find((o) => o.op === c.op);
        const deArchivo = OPS_DE_ARCHIVO.has(c.op);
        return (
          <div key={i} className={styles.condicion}>
            <select
              className={styles.select}
              value={deArchivo ? "file" : c.ref}
              disabled={deArchivo}
              onChange={(e) =>
                confirmar(
                  combinador,
                  condiciones.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)),
                )
              }
            >
              {deArchivo && <option value="file">el archivo</option>}
              {columnas.map((col) => (
                <option key={col.ref} value={col.ref}>
                  {col.ref}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={c.op}
              onChange={(e) => {
                const op = e.target.value;
                confirmar(
                  combinador,
                  condiciones.map((x, j) =>
                    j === i ? { ...x, op, ref: OPS_DE_ARCHIVO.has(op) ? "file" : x.ref } : x,
                  ),
                );
              }}
            >
              {OPERADORES_UI.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
            {meta?.sinValor !== true && (
              <input
                className={styles.input}
                value={c.valor}
                placeholder="valor"
                // Solo el borrador mientras se teclea; se guarda al confirmar.
                onChange={(e) =>
                  setCondiciones(
                    condiciones.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)),
                  )
                }
                onBlur={() => onCambio(combinador, condiciones)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setCondiciones(planas.condiciones);
                }}
              />
            )}
            <button
              type="button"
              className={styles.quitar}
              aria-label="Quitar esta condición"
              title="Quitar"
              onClick={() => confirmar(combinador, condiciones.filter((_, j) => j !== i))}
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className={styles.botonSecundario}
        onClick={() =>
          // Añadir NO guarda: una condición sin valor no llega al archivo, y
          // guardar acá dejaría el filtro a medio escribir en disco.
          setCondiciones([
            ...condiciones,
            { ref: columnas[0]?.ref ?? "file.name", op: "==", valor: "" },
          ])
        }
      >
        <Plus size={13} aria-hidden /> Añadir condición
      </button>
    </div>
  );
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

/**
 * Una celda. Usa el mismo lenguaje visual que la tarjeta de propiedades de
 * `FUN-M-04` —píldoras para las listas, fechas en formato local— para que un
 * valor se vea igual acá que dentro de su nota.
 */
function Celda({
  columna,
  valores,
  nota,
}: {
  columna: string;
  valores: string[] | undefined;
  nota: NotaTabla;
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
            {v}
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
  return <>{unico}</>;
}
