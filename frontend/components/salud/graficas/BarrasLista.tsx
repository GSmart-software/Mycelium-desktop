"use client";

import { entero } from "@/lib/informeSalud";
import { EstadoVacio } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip, type Detalle } from "./Tooltip";

export type ItemBarra = {
  clave: string;
  nombre: string;
  valor: number;
  /** El texto accesible y el del tooltip («320 conexiones»). */
  detalle: Detalle;
};

/**
 * Una lista de barras finas en HTML, una fila por ítem escalada al mayor: las
 * notas más conectadas y las etiquetas más usadas. Cada fila es un botón (se
 * llega con Tab, se elige con Enter o clic): abre la nota, busca la etiqueta.
 */
export function BarrasLista({
  items,
  vacio,
  onElegir,
  etiqueta,
  comoEnlace = false,
}: {
  items: readonly ItemBarra[];
  vacio: string;
  onElegir: (clave: string) => void;
  etiqueta: string;
  /** El nombre como un `[[enlace]]` (las notas) o como texto (las etiquetas). */
  comoEnlace?: boolean;
}) {
  const { con, nodo } = useTooltip();
  if (items.length === 0) return <EstadoVacio texto={vacio} />;
  const max = Math.max(...items.map((i) => i.valor), 1);
  return (
    <>
      <ul className={`mic-grafica ${styles.hubs}`} aria-label={etiqueta}>
        {items.map((i) => (
          <li key={i.clave}>
            <button
              type="button"
              className={styles.hub}
              onClick={() => onElegir(i.clave)}
              aria-label={`${i.nombre}: ${i.detalle.valor ?? entero(i.valor)}`}
              {...con(i.detalle)}
            >
              <span className={comoEnlace ? styles.hubNombre : styles.hubTexto}>{i.nombre}</span>
              <span className={styles.hubBarra} aria-hidden>
                <i style={{ width: `${(i.valor / max) * 100}%` }} />
              </span>
              <span className={styles.hubValor}>{entero(i.valor)}</span>
            </button>
          </li>
        ))}
      </ul>
      {nodo}
    </>
  );
}
