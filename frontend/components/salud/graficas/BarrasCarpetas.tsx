"use client";

import { GRUPOS, NOMBRE_GRUPO, RAIZ, type CarpetaPrimerNivel } from "@/lib/estadisticas";
import { acortar, barraHorizontal, carpetasConResto, textoDe, tramos, valorDe, type Medida } from "@/lib/graficas";
import { porcentaje } from "@/lib/informeSalud";
import { usePaletaGraficas } from "@/lib/usePaletaGraficas";
import { EstadoVacio } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

const ALTO_FILA = 28;
const ALTO_BARRA = 17;
const COL_VALOR = 64;

/**
 * «Qué ocupa espacio»: una barra por carpeta de primer nivel, partida por grupo
 * de tipo (lo que más pesa primero) y escalada a la carpeta más grande. Más de
 * `tope` carpetas: las demás se suman en la última fila.
 */
export function BarrasCarpetas({
  carpetas,
  medida = "bytes",
  tope = 8,
}: {
  carpetas: readonly CarpetaPrimerNivel[];
  medida?: Medida;
  tope?: number;
}) {
  const paleta = usePaletaGraficas();
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();
  const filas = carpetasConResto(carpetas, tope).filter((c) => valorDe(c, medida) > 0);

  if (filas.length === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto={carpetas.length === 0 ? "El vault todavía no tiene archivos." : "Las carpetas no pesan nada todavía."} />
      </div>
    );
  }

  const colNombre = Math.min(130, Math.max(80, Math.round(ancho * 0.22)));
  const largo = Math.max(40, ancho - colNombre - COL_VALOR);
  const maximo = Math.max(...filas.map((c) => valorDe(c, medida)));
  const alto = filas.length * ALTO_FILA - (ALTO_FILA - ALTO_BARRA);
  const nombreDe = (c: { carpeta: string; resto: boolean }) => (c.resto ? c.carpeta : c.carpeta === RAIZ ? "Raíz" : c.carpeta);
  const etiqueta =
    `${medida === "bytes" ? "Peso" : "Archivos"} por carpeta: ` + filas.map((c) => `${nombreDe(c)} ${textoDe(valorDe(c, medida), medida)}`).join(", ");

  return (
    <div ref={ref} className={styles.contenedor}>
      {ancho > 0 && (
        <svg className={`mic-grafica ${styles.svg}`} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta}>
          {filas.map((c, i) => {
            const y = i * ALTO_FILA;
            const total = valorDe(c, medida);
            const partes = tramos(
              [...GRUPOS]
                .map((g) => ({ clave: g, valor: valorDe(c.porGrupo[g], medida) }))
                .sort((a, b) => b.valor - a.valor),
              largo,
              { x0: colNombre, escalaDe: maximo },
            );
            const fin = partes.length > 0 ? partes[partes.length - 1].x + partes[partes.length - 1].w : colNombre;
            return (
              <g key={c.carpeta}>
                <text className={styles.rotulo} x={0} y={y + 13}>
                  <title>{nombreDe(c)}</title>
                  {acortar(nombreDe(c), Math.max(8, Math.floor(colNombre / 7.5)))}
                </text>
                {partes.map((p, j) => {
                  const detalle = {
                    titulo: `${nombreDe(c)} · ${NOMBRE_GRUPO[p.clave]}`,
                    valor: textoDe(p.valor, medida),
                    nota: `${porcentaje(p.valor, total)} de la carpeta`,
                  };
                  return j === partes.length - 1 ? (
                    <path
                      key={p.clave}
                      className={styles.marca}
                      d={barraHorizontal(p.x, y, p.w, ALTO_BARRA)}
                      style={{ fill: paleta.grupos[p.clave] }}
                      {...con(detalle)}
                    />
                  ) : (
                    <rect
                      key={p.clave}
                      className={styles.marca}
                      x={p.x}
                      y={y}
                      width={p.w}
                      height={ALTO_BARRA}
                      style={{ fill: paleta.grupos[p.clave] }}
                      {...con(detalle)}
                    />
                  );
                })}
                <text className={styles.valor} x={fin + 6} y={y + 12.5}>
                  {textoDe(total, medida)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {nodo}
    </div>
  );
}
