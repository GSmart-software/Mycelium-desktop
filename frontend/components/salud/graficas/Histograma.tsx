"use client";

import type { CuboConexiones } from "@/lib/estadisticas";
import { barraVertical, escala, plural } from "@/lib/graficas";
import { entero } from "@/lib/informeSalud";
import { EstadoVacio } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

const ALTO_GRAFICA = 130;
const ARRIBA = 14;
const COL_EJE = 34;

const conexionesDe = (c: CuboConexiones) => (c.etiqueta === "1" ? "1 conexión" : `${c.etiqueta} conexiones`);

/**
 * El histograma de «La red»: cuántas notas tienen 0, 1, 2, 3–5… conexiones.
 * La parte de cada columna que son huérfanas (nadie las enlaza) va en gris,
 * abajo; el resto, en el acento.
 */
export function Histograma({ cubos }: { cubos: readonly CuboConexiones[] }) {
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();
  const total = cubos.reduce((s, c) => s + c.notas, 0);

  if (total === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto="Todavía no hay notas para medir sus conexiones." />
      </div>
    );
  }

  const largo = Math.max(60, ancho - COL_EJE);
  const e = escala(Math.max(...cubos.map((c) => c.notas)), ALTO_GRAFICA);
  const col = largo / cubos.length;
  const ancoBarra = Math.max(4, Math.min(48, col - 12));
  const base = ARRIBA + ALTO_GRAFICA;
  const alto = base + 32;
  const mayor = cubos.reduce((m, c, i) => (c.notas > cubos[m].notas ? i : m), 0);
  const etiqueta =
    "Notas según sus conexiones: " + cubos.map((c) => `${conexionesDe(c)}, ${plural(c.notas, "nota", "notas")}`).join("; ");

  return (
    <div ref={ref} className={styles.contenedor}>
      {ancho > 0 && (
        <svg className={`mic-grafica ${styles.svg}`} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta}>
          {e.marcas.map((m) => {
            const y = base - e.px(m);
            return (
              <g key={m}>
                <line className={styles.grilla} x1={COL_EJE} x2={ancho} y1={y} y2={y} />
                <text x={COL_EJE - 6} y={y + 4} textAnchor="end">
                  {entero(m)}
                </text>
              </g>
            );
          })}
          {cubos.map((c, i) => {
            const x = COL_EJE + i * col + (col - ancoBarra) / 2;
            const hTotal = e.px(c.notas);
            const hGris = e.px(c.huerfanas);
            const hResto = hTotal - hGris;
            const detalle = {
              titulo: conexionesDe(c),
              valor: plural(c.notas, "nota", "notas"),
              nota:
                c.huerfanas === 0
                  ? undefined
                  : c.huerfanas === c.notas
                    ? "todas huérfanas: nadie las enlaza"
                    : `${plural(c.huerfanas, "huérfana", "huérfanas")}: nadie las enlaza`,
            };
            return (
              <g key={c.etiqueta} className={styles.marca} {...con(detalle)}>
                <rect x={x - 4} y={ARRIBA} width={ancoBarra + 8} height={ALTO_GRAFICA} fill="transparent" />
                {hGris > 0 &&
                  (hResto > 0 ? (
                    <rect className={styles.serieGris} x={x} y={base - hGris} width={ancoBarra} height={hGris} />
                  ) : (
                    <path className={styles.serieGris} d={barraVertical(x, base - hGris, ancoBarra, hGris)} />
                  ))}
                {hResto > 0 && (
                  <path className={styles.serie} d={barraVertical(x, base - hTotal, ancoBarra, hResto - (hGris > 0 ? 2 : 0))} />
                )}
                <text x={x + ancoBarra / 2} y={base + 15} textAnchor="middle">
                  {c.etiqueta}
                </text>
                {(i === 0 || i === mayor) && c.notas > 0 && (
                  <text className={styles.valor} x={x + ancoBarra / 2} y={base - hTotal - 5} textAnchor="middle">
                    {entero(c.notas)}
                  </text>
                )}
              </g>
            );
          })}
          {cubos.some((c) => c.huerfanas > 0) && (
            <g aria-hidden>
              <rect className={styles.serieGris} x={COL_EJE} y={base + 22} width={9} height={9} rx={2} />
              <text x={COL_EJE + 14} y={base + 30}>
                huérfanas: nadie las enlaza
              </text>
            </g>
          )}
          <text x={ancho} y={base + 30} textAnchor="end">
            conexiones por nota
          </text>
        </svg>
      )}
      {nodo}
    </div>
  );
}
