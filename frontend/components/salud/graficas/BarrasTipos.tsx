"use client";

import { NOMBRE_GRUPO, type ComposicionArchivos } from "@/lib/estadisticas";
import { barraHorizontal, escala, nombreDeExtension, rotuloExtension, textoDe, tiposOrdenados, valorDe, type Medida } from "@/lib/graficas";
import { entero, pesoLegible, porcentaje } from "@/lib/informeSalud";
import { usePaletaGraficas } from "@/lib/usePaletaGraficas";
import { EstadoVacio, type Resaltado } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

const ALTO_FILA = 34;
const ALTO_BARRA = 18;
/** Columna de los nombres, y lo que se reserva a la derecha para el valor. */
const COL_NOMBRE = 112;
const COL_VALOR = 118;

/**
 * Las barras de «Qué hay en el vault»: una por tipo de archivo (cada extensión
 * por separado), de mayor a menor, con el color de su grupo. Los tipos con 0
 * no aparecen.
 */
export function BarrasTipos({
  archivos,
  medida,
  resaltado = null,
  onResaltar,
}: { archivos: ComposicionArchivos; medida: Medida } & Resaltado) {
  const paleta = usePaletaGraficas();
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();
  const tipos = tiposOrdenados(archivos, medida).filter((t) => valorDe(t, medida) > 0);
  const total = valorDe(archivos.total, medida);

  if (tipos.length === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto="El vault todavía no tiene archivos." />
      </div>
    );
  }

  const largo = Math.max(40, ancho - COL_NOMBRE - COL_VALOR);
  const e = escala(valorDe(tipos[0], medida), largo);
  const alto = tipos.length * ALTO_FILA + 4;
  const etiqueta =
    `Archivos por tipo, por ${medida === "bytes" ? "peso" : "cantidad"}: ` +
    tipos.map((t) => `${nombreDeExtension(t.extension)} ${rotuloExtension(t.extension)} ${textoDe(valorDe(t, medida), medida)}`).join(", ");

  return (
    <div ref={ref} className={styles.contenedor}>
      {ancho > 0 && (
        <svg
          className={`mic-grafica ${styles.svg}`}
          width={ancho}
          height={alto}
          viewBox={`0 0 ${ancho} ${alto}`}
          role="img"
          aria-label={etiqueta}
          data-resaltado={resaltado ?? undefined}
        >
          {e.marcas.map((m) => (
            <line key={m} className={styles.grilla} x1={COL_NOMBRE + e.px(m)} x2={COL_NOMBRE + e.px(m)} y1={0} y2={alto - 6} />
          ))}
          {tipos.map((t, i) => {
            const y = i * ALTO_FILA;
            const v = valorDe(t, medida);
            const w = Math.max(2, e.px(v));
            const detalle = {
              titulo: `${nombreDeExtension(t.extension)} (${rotuloExtension(t.extension)})`,
              valor: `${entero(t.cantidad)} ${t.cantidad === 1 ? "archivo" : "archivos"} · ${pesoLegible(t.bytes)}`,
              nota: `grupo ${NOMBRE_GRUPO[t.grupo].toLowerCase()} · ${porcentaje(v, total)} ${medida === "bytes" ? "del peso" : "de los archivos"}`,
            };
            return (
              <g
                key={t.extension || "(sin)"}
                className={styles.marca}
                data-grupo={t.grupo}
                data-on={resaltado === t.grupo || undefined}
                {...con(detalle, (dentro) => onResaltar?.(dentro ? t.grupo : null))}
              >
                <rect x={0} y={y} width={ancho} height={ALTO_FILA} fill="transparent" />
                <text className={styles.rotulo} x={0} y={y + 13}>
                  {nombreDeExtension(t.extension)}
                </text>
                <text x={0} y={y + 27}>
                  {rotuloExtension(t.extension)}
                </text>
                <path d={barraHorizontal(COL_NOMBRE, y + 5, w, ALTO_BARRA)} style={{ fill: paleta.grupos[t.grupo] }} />
                <text className={styles.valor} x={COL_NOMBRE + w + 8} y={y + 18}>
                  {textoDe(v, medida)} · {porcentaje(v, total)}
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
