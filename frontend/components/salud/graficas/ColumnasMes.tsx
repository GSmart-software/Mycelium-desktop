"use client";

import type { MesCrecimiento } from "@/lib/estadisticas";
import { barraVertical, escala, mesCorto, mesLargo, plural } from "@/lib/graficas";
import { entero } from "@/lib/informeSalud";
import { EstadoVacio } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

const ALTO_GRAFICA = 140;
const ARRIBA = 14;
const COL_EJE = 34;

/**
 * «Crecimiento»: notas nuevas por mes, una columna por mes (12). El mes actual
 * en el acento; los anteriores, en el acento mezclado con la superficie.
 */
export function ColumnasMes({ meses }: { meses: readonly MesCrecimiento[] }) {
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();
  const total = meses.reduce((s, m) => s + m.notas, 0);

  if (meses.length === 0 || total === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto="No hay notas nuevas en los últimos 12 meses." />
      </div>
    );
  }

  const largo = Math.max(60, ancho - COL_EJE);
  const e = escala(Math.max(...meses.map((m) => m.notas)), ALTO_GRAFICA);
  const col = largo / meses.length;
  const anchoBarra = Math.max(4, Math.min(44, col - 14));
  const base = ARRIBA + ALTO_GRAFICA;
  const alto = base + 20;
  const mayor = meses.reduce((m, x, i) => (x.notas > meses[m].notas ? i : m), 0);
  let acumulado = 0;
  const etiqueta = "Notas nuevas por mes: " + meses.map((m) => `${mesLargo(m.mes)}, ${m.notas}`).join("; ");

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
          {meses.map((m, i) => {
            acumulado += m.notas;
            const ultimo = i === meses.length - 1;
            const x = COL_EJE + i * col + (col - anchoBarra) / 2;
            const h = e.px(m.notas);
            return (
              <g
                key={m.mes}
                className={styles.marca}
                {...con({
                  titulo: mesLargo(m.mes),
                  valor: `${plural(m.notas, "nota nueva", "notas nuevas")}`,
                  nota: i === 0 ? undefined : `${entero(acumulado)} desde ${mesLargo(meses[0].mes)}`,
                })}
              >
                <rect x={x - 4} y={ARRIBA} width={anchoBarra + 8} height={ALTO_GRAFICA} fill="transparent" />
                {h > 0 && <path className={ultimo ? styles.serie : styles.serieTenue} d={barraVertical(x, base - h, anchoBarra, h)} />}
                <text x={x + anchoBarra / 2} y={base + 15} textAnchor="middle">
                  {col >= 26 || i % 2 === meses.length % 2 ? mesCorto(m.mes) : ""}
                </text>
                {(ultimo || i === mayor) && m.notas > 0 && (
                  <text className={styles.valor} x={x + anchoBarra / 2} y={base - h - 5} textAnchor="middle">
                    {entero(m.notas)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {nodo}
    </div>
  );
}
