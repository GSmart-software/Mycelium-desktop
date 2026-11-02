"use client";

import type { MesCrecimiento } from "@/lib/estadisticas";
import { mesCorto, mesLargo, plural } from "@/lib/graficas";
import { entero } from "@/lib/informeSalud";
import { EstadoVacio } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

const ALTO_CURVA = 44;
const ARRIBA = 6;
const LADO = 4;

/**
 * La curva chica del panel lateral: notas nuevas por mes en los últimos 12
 * meses, con el área tenue debajo y un punto en el mes actual. El detalle de
 * cada mes, al pasar el puntero por su franja.
 */
export function CurvaMeses({ meses }: { meses: readonly MesCrecimiento[] }) {
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();
  const total = meses.reduce((s, m) => s + m.notas, 0);

  if (meses.length < 2 || total === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto="No hay notas nuevas en los últimos 12 meses." />
      </div>
    );
  }

  const max = Math.max(...meses.map((m) => m.notas));
  // La curva se mete `LADO` px de cada costado para que el punto del último mes
  // no quede cortado por el borde del panel.
  const paso = Math.max(0, ancho - 2 * LADO) / (meses.length - 1);
  const base = ARRIBA + ALTO_CURVA;
  const puntos = meses.map((m, i) => [Math.round((LADO + i * paso) * 10) / 10, Math.round((base - (m.notas / max) * ALTO_CURVA) * 10) / 10]);
  const linea = "M" + puntos.map((p) => p.join(",")).join("L");
  const [x0] = puntos[0];
  const ultimo = meses[meses.length - 1];
  const [ux, uy] = puntos[puntos.length - 1];
  const alto = base + 16;
  const etiqueta = `Notas nuevas por mes, últimos ${meses.length} meses: ${plural(total, "nota", "notas")}; ${mesLargo(ultimo.mes)}, ${ultimo.notas}.`;

  return (
    <div ref={ref} className={styles.contenedor}>
      {ancho > 0 && (
        <svg className={`mic-grafica ${styles.svg}`} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta}>
          <path className={styles.area} d={`${linea}L${ux},${base}L${x0},${base}Z`} />
          <path className={styles.linea} d={linea} />
          <circle className={styles.punto} cx={ux} cy={uy} r={3.5} />
          {meses.map((m, i) => (
            <rect
              key={m.mes}
              className={styles.marca}
              x={i === 0 ? 0 : LADO + i * paso - paso / 2}
              y={0}
              width={i === 0 || i === meses.length - 1 ? paso / 2 + LADO : paso}
              height={base}
              fill="transparent"
              {...con({ titulo: mesLargo(m.mes), valor: plural(m.notas, "nota nueva", "notas nuevas") })}
            />
          ))}
          <text x={0} y={base + 13}>
            {mesCorto(meses[0].mes)}
          </text>
          <text className={styles.valor} x={ancho} y={base + 13} textAnchor="end">
            {mesCorto(ultimo.mes)} · {entero(ultimo.notas)}
          </text>
        </svg>
      )}
      {nodo}
    </div>
  );
}
