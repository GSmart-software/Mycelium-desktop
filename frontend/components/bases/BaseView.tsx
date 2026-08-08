"use client";

import { AlertTriangle, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  construirTabla,
  parsearBase,
  tituloColumna,
  type Base,
  type NotaTabla,
  type Vista,
} from "@/lib/bases";
import { formatearFecha } from "@/lib/markdown";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import styles from "./BaseView.module.css";

/**
 * Vista de un archivo `.base` (`FUN-L-03`): la tabla de notas que agrega.
 *
 * Es de **solo lectura** por decisión de diseño: para cambiar un valor se abre
 * la nota. Escribir desde la tabla tocaría el frontmatter de N archivos y habría
 * que resolver el conflicto con el editor abierto y el deshacer, que es de donde
 * salieron `DEF-031`/`DEF-037`.
 */
export function BaseView({ notaId }: { notaId: string }) {
  const router = useRouter();
  const [fuente, setFuente] = useState<string | null>(null);
  const [notas, setNotas] = useState<NotaTabla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vistaActiva, setVistaActiva] = useState(0);
  /** Vistas en las que el usuario pidió ver las filas pese al filtro roto. */
  const [sinFiltrar, setSinFiltrar] = useState<Record<number, boolean>>({});
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
        setNotas(tabla.notas);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [notaId, vaultId]);

  // El parseo puede lanzar (YAML inválido): se captura acá y se muestra el
  // motivo en vez de dejar el pane en blanco.
  const parseado = useMemo((): { base: Base } | { errorYaml: string } | null => {
    if (fuente === null) return null;
    try {
      return { base: parsearBase(fuente) };
    } catch (e) {
      return { errorYaml: e instanceof Error ? e.message : String(e) };
    }
  }, [fuente]);

  if (error !== null) {
    return <p className={styles.aviso}>No se pudo cargar la base: {error}</p>;
  }
  if (parseado === null || notas === null) {
    return <p className={styles.cargando}>Cargando la base…</p>;
  }
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
        <pre className={styles.crudo}>
          <code>{fuente}</code>
        </pre>
      </div>
    );
  }

  const { base } = parseado;
  const vista: Vista = base.vistas[Math.min(vistaActiva, base.vistas.length - 1)];
  const ignorar = sinFiltrar[vistaActiva] === true;
  const tabla = construirTabla(base, vista, notas, { ignorarFiltros: ignorar });

  const abrir = (id: string) => {
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.cabecera}>
        <Table2 size={15} aria-hidden />
        {base.vistas.length > 1 ? (
          <div className={styles.vistas} role="tablist">
            {base.vistas.map((v, i) => (
              <button
                key={`${v.nombre}-${i}`}
                type="button"
                role="tab"
                aria-selected={i === vistaActiva}
                className={i === vistaActiva ? styles.vistaActiva : styles.vista}
                onClick={() => setVistaActiva(i)}
              >
                {v.nombre}
              </button>
            ))}
          </div>
        ) : (
          <span className={styles.titulo}>{vista.nombre}</span>
        )}
        {tabla.ok && (
          <span className={styles.recuento}>
            {tabla.total} {tabla.total === 1 ? "nota" : "notas"}
            {tabla.recortadas > 0 && ` · ${tabla.recortadas} ocultas por el límite`}
          </span>
        )}
      </header>

      {base.ignoradas.length > 0 && (
        <p className={styles.aviso}>
          Mycelium todavía no interpreta{" "}
          {base.ignoradas.map((k) => <code key={k}>{k}</code>).reduce((a, b) => (
            <>
              {a}, {b}
            </>
          ))}
          : esa parte del archivo se conserva intacta, pero no afecta a la tabla.
        </p>
      )}

      {!tabla.ok ? (
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
              onClick={() => setSinFiltrar((s) => ({ ...s, [vistaActiva]: true }))}
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
                  <tr key={nota.id} onClick={() => abrir(nota.id)} tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") abrir(nota.id);
                      }}>
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
