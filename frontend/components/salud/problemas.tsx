"use client";

import { CircleAlert, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { setPendingMatch } from "@/lib/editor/pendingMatch";
import { RUTA_ESQUEMAS } from "@/lib/esquemas";
import { entero } from "@/lib/informeSalud";
import type { Duplicado, InformeSalud, NotaConAvisos, NotaRef, Problema } from "@/lib/salud";
import { avisar } from "@/stores/avisosStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./problemas.module.css";

/**
 * Las filas de los problemas de salud (`FUN-L-30`), compartidas por el panel
 * lateral y la pestaña «Salud del vault» (`FUN-L-32`): cada una lleva a la nota
 * y, si se sabe, a la línea.
 */

/** Cuántos ítems dibuja cada clase de problema; el resto se cuenta. */
export const TOPE_VISIBLE = 200;

export type Ir = (id: string, linea?: number) => void;

/** Abre la nota (y la línea) de un problema; avisa si la nota ya no está. */
export function useIrANota(): Ir {
  const router = useRouter();
  return useCallback(
    (id: string, linea?: number) => {
      if (!useVaultStore.getState().notas.some((n) => n.id === id)) {
        avisar(`«${id}» ya no existe (puede haberse renombrado o borrado). Vuelve a revisar el vault.`);
        return;
      }
      if (linea !== undefined) setPendingMatch(id, { linea });
      useTabsStore.getState().openNote(id);
      router.replace(`/workspace?note=${encodeURIComponent(id)}`);
      if (linea !== undefined) {
        window.dispatchEvent(new CustomEvent("micelio:goto-match", { detail: { notaId: id, linea } }));
      }
    },
    [router],
  );
}

/** El título de una nota por su id, con el nombre del archivo si no está en el índice. */
export function useTituloDeNota(): (id: string) => string {
  const notas = useVaultStore((s) => s.notas);
  const titulos = useMemo(() => new Map(notas.map((n) => [n.id, n.titulo])), [notas]);
  return useCallback((id: string) => titulos.get(id) ?? id.slice(id.lastIndexOf("/") + 1), [titulos]);
}

const escrito = (p: Problema) => `${p.tipo === "embed" ? "!" : ""}[[${p.texto}]]`;

export function ItemProblema({ p, tituloDesde, ir }: { p: Problema; tituloDesde: string; ir: Ir }) {
  const linea = p.lineas[0];
  return (
    <li>
      <button type="button" className={styles.item} onClick={() => ir(p.desde, linea)} title={`Abrir ${p.desde}`}>
        <span className={styles.itemTitulo}>{tituloDesde}</span>
        <span className={styles.itemDetalle}>
          <code className={styles.codigo}>{escrito(p)}</code>
          {p.lineas.length > 0 && ` · ${p.lineas.length === 1 ? "línea" : "líneas"} ${p.lineas.join(", ")}`}
          {p.tipo === "canvas" && " · en una tarjeta del lienzo"}
        </span>
      </button>
    </li>
  );
}

export function ItemDuplicado({ d, titulo, ir }: { d: Duplicado; titulo: (id: string) => string; ir: Ir }) {
  return (
    <li className={styles.grupo}>
      <p className={styles.grupoTitulo}>
        «{d.titulo}» · {d.rutas.length} notas
        {d.ambiguos.length > 0 && ` · ${d.ambiguos.length} ${d.ambiguos.length === 1 ? "enlace ambiguo" : "enlaces ambiguos"}`}
      </p>
      <ul className={styles.lista}>
        {d.rutas.map((r) => (
          <li key={r}>
            <button type="button" className={styles.item} onClick={() => ir(r)} title={`Abrir ${r}`}>
              <span className={styles.itemDetalle}>{r}</span>
            </button>
          </li>
        ))}
        {d.ambiguos.map((p, i) => (
          <ItemProblema key={`${p.desde}-${p.texto}-${i}`} p={p} tituloDesde={`Ambiguo en ${titulo(p.desde)}`} ir={ir} />
        ))}
      </ul>
    </li>
  );
}

export function ItemPropiedades({ n, ir }: { n: NotaConAvisos; ir: Ir }) {
  return (
    <li className={styles.grupo}>
      <p className={styles.grupoTitulo}>
        {n.titulo} · {n.avisos.length} {n.avisos.length === 1 ? "aviso" : "avisos"}
      </p>
      <ul className={styles.lista}>
        {n.avisos.map((a, i) => (
          <li key={`${a.linea}-${i}`}>
            <button type="button" className={styles.item} onClick={() => ir(n.ruta, a.linea)} title={`Abrir ${n.ruta}`}>
              <span className={styles.itemDetalle}>
                Línea {a.linea} · {a.mensaje}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function ItemNota({ n, ir }: { n: NotaRef; ir: Ir }) {
  return (
    <li>
      <button type="button" className={styles.item} onClick={() => ir(n.ruta)} title={`Abrir ${n.ruta}`}>
        <span className={styles.itemTitulo}>{n.titulo}</span>
        {n.ruta.includes("/") && <span className={styles.itemDetalle}>{n.ruta}</span>}
      </button>
    </li>
  );
}

// ── La lista por gravedad ───────────────────────────────────────────────────

export type Gravedad = "grave" | "importante" | "aviso" | "revisar";

/** Ícono y texto de cada gravedad: nunca solo color (spec, «Estilo»). */
export const GRAVEDAD: Record<Gravedad, { nombre: string; icono: LucideIcon }> = {
  grave: { nombre: "Grave", icono: TriangleAlert },
  importante: { nombre: "Importante", icono: CircleAlert },
  aviso: { nombre: "Aviso", icono: CircleAlert },
  revisar: { nombre: "Para revisar", icono: Info },
};

type Clase = {
  id: string;
  titulo: string;
  gravedad: Gravedad;
  descripcion: string;
  cuenta: number;
  /** Las filas, hasta `tope`. */
  items: (tope: number) => React.ReactNode;
};

/**
 * Las clases de problema en orden de gravedad: graves (enlaces y embeds
 * rotos), importante (títulos duplicados, con sus enlaces ambiguos), aviso
 * (propiedades) y para revisar (huérfanas y sin enlaces salientes). La suma es
 * `conteos(informe).total`, y graves es la de `gravedades()` del informe.
 */
function clases(informe: InformeSalud, titulo: (id: string) => string, ir: Ir): Clase[] {
  return [
    {
      id: "rotos",
      titulo: "Enlaces rotos",
      gravedad: "grave",
      descripcion: "Apuntan a notas que no existen",
      cuenta: informe.rotos.length,
      items: (tope) => informe.rotos.slice(0, tope).map((p, i) => (
        <ItemProblema key={`${p.desde}-${p.tipo}-${p.texto}-${i}`} p={p} tituloDesde={titulo(p.desde)} ir={ir} />
      )),
    },
    {
      id: "embeds",
      titulo: "Embeds rotos",
      gravedad: "grave",
      descripcion: "Embebidos de algo que no está en el vault",
      cuenta: informe.embedsRotos.length,
      items: (tope) => informe.embedsRotos.slice(0, tope).map((p, i) => (
        <ItemProblema key={`${p.desde}-${p.texto}-${i}`} p={p} tituloDesde={titulo(p.desde)} ir={ir} />
      )),
    },
    {
      id: "duplicados",
      titulo: "Títulos duplicados",
      gravedad: "importante",
      descripcion: "Un enlace sin carpeta no sabe a cuál ir",
      cuenta: informe.duplicados.length,
      items: (tope) => informe.duplicados.slice(0, tope).map((d) => (
        <ItemDuplicado key={`${d.tipo}-${d.titulo}`} d={d} titulo={titulo} ir={ir} />
      )),
    },
    {
      id: "propiedades",
      titulo: "Propiedades",
      gravedad: "aviso",
      descripcion: `No cumplen los esquemas de ${RUTA_ESQUEMAS}`,
      cuenta: informe.propiedades?.length ?? 0,
      items: (tope) => (informe.propiedades ?? []).slice(0, tope).map((n) => <ItemPropiedades key={n.ruta} n={n} ir={ir} />),
    },
    {
      id: "huerfanas",
      titulo: "Huérfanas",
      gravedad: "revisar",
      descripcion: "Ninguna otra nota las enlaza",
      cuenta: informe.huerfanas.length,
      items: (tope) => informe.huerfanas.slice(0, tope).map((n) => <ItemNota key={n.ruta} n={n} ir={ir} />),
    },
    {
      id: "sinSalientes",
      titulo: "Sin enlaces salientes",
      gravedad: "revisar",
      descripcion: "No enlazan a ninguna otra nota",
      cuenta: informe.sinSalientes.length,
      items: (tope) => informe.sinSalientes.slice(0, tope).map((n) => <ItemNota key={n.ruta} n={n} ir={ir} />),
    },
  ];
}

/**
 * Los problemas del vault por gravedad, cada clase desplegable con sus filas.
 * Arranca abierta la primera clase que tenga problemas. Las clases vacías se
 * ven igual, atenuadas y con 0, para que se sepa que se revisaron.
 */
export function ListaProblemas({ informe, tope = TOPE_VISIBLE }: { informe: InformeSalud; tope?: number }) {
  const ir = useIrANota();
  const titulo = useTituloDeNota();
  const lista = clases(informe, titulo, ir);
  const primera = lista.find((c) => c.cuenta > 0)?.id ?? null;
  const [abiertas, setAbiertas] = useState<Set<string> | null>(null);
  // Las clases en las que se pidió ver todo (hasta `TOPE_VISIBLE`).
  const [completas, setCompletas] = useState<ReadonlySet<string>>(new Set());
  const abierta = (id: string) => (abiertas ? abiertas.has(id) : id === primera);
  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev ?? (primera ? [primera] : []));
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  return (
    <div className={styles.problemas}>
      {informe.avisosEsquemas.length > 0 && (
        <div className={styles.error} role="status">
          <p>
            {RUTA_ESQUEMAS} tiene {informe.avisosEsquemas.length === 1 ? "un problema" : `${informe.avisosEsquemas.length} problemas`}; lo que no se
            entiende se ignora:
          </p>
          <ul className={styles.lista}>
            {informe.avisosEsquemas.map((a, i) => (
              <li key={i}>
                {a.linea !== undefined && `Línea ${a.linea}: `}
                {a.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lista.map((c) => {
        const { icono: Icono, nombre } = GRAVEDAD[c.gravedad];
        const ab = c.cuenta > 0 && abierta(c.id);
        return (
          <div key={c.id} className={styles.clase} data-gravedad={c.gravedad} data-vacia={c.cuenta === 0 || undefined}>
            <button
              type="button"
              className={styles.claseCabecera}
              aria-expanded={c.cuenta > 0 ? ab : undefined}
              disabled={c.cuenta === 0}
              onClick={() => alternar(c.id)}
            >
              <Icono size={17} className={styles.icono} aria-hidden />
              <span className={styles.claseTexto}>
                <span className={styles.claseTitulo}>{c.titulo}</span>
                <span className={styles.claseDetalle}>
                  {nombre} · {c.descripcion}
                </span>
              </span>
              <span className={styles.cuenta} data-cero={c.cuenta === 0 || undefined}>
                {entero(c.cuenta)}
              </span>
            </button>
            {ab && (() => {
              const limite = completas.has(c.id) ? TOPE_VISIBLE : Math.min(tope, TOPE_VISIBLE);
              const resto = c.cuenta - limite;
              return (
                <>
                  <ul className={`${styles.lista} ${styles.items}`}>{c.items(limite)}</ul>
                  {resto > 0 &&
                    (limite < TOPE_VISIBLE ? (
                      <button type="button" className={styles.verTodos} onClick={() => setCompletas((p) => new Set(p).add(c.id))}>
                        {c.cuenta > TOPE_VISIBLE
                          ? `Ver ${entero(TOPE_VISIBLE)} de ${entero(c.cuenta)}`
                          : `Ver todo (${entero(c.cuenta)})`}
                      </button>
                    ) : (
                      <p className={styles.mas}>Y {entero(resto)} más.</p>
                    ))}
                </>
              );
            })()}
          </div>
        );
      })}
      <p className={styles.nota}>
        No se revisan las Esporas (son plantillas) ni los archivos de instrucciones para agentes de la raíz (CLAUDE.md, AGENTS.md).
      </p>
    </div>
  );
}
