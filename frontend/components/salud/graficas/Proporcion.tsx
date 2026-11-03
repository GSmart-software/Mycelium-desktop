"use client";

import { GRUPOS, NOMBRE_GRUPO, type ComposicionArchivos } from "@/lib/estadisticas";
import { textoDe, tramos, valorDe, type Medida } from "@/lib/graficas";
import { porcentaje } from "@/lib/informeSalud";
import { usePaletaGraficas } from "@/lib/usePaletaGraficas";
import { EstadoVacio, type Resaltado } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

const COL_ROTULO = 64;
const ALTO = 22;
const ENTRE = 10;

/**
 * Dos barras al 100 %, «Archivos» y «Peso», partidas por grupo de tipo: la
 * composición del panel lateral. Lleva su leyenda abajo (`Leyenda`).
 */
export function Proporcion({ archivos, resaltado = null, onResaltar }: { archivos: ComposicionArchivos } & Resaltado) {
  const paleta = usePaletaGraficas();
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();

  if (archivos.total.cantidad === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto="El vault todavía no tiene archivos." />
      </div>
    );
  }

  const largo = Math.max(40, ancho - COL_ROTULO);
  const filas: { rotulo: string; medida: Medida }[] = [
    { rotulo: "Archivos", medida: "cantidad" },
    { rotulo: "Peso", medida: "bytes" },
  ];
  const alto = filas.length * ALTO + (filas.length - 1) * ENTRE;
  const etiqueta = filas
    .map(
      (f) =>
        `${f.rotulo}: ` +
        GRUPOS.filter((g) => valorDe(archivos.porGrupo[g], f.medida) > 0)
          .map((g) => `${NOMBRE_GRUPO[g]} ${porcentaje(valorDe(archivos.porGrupo[g], f.medida), valorDe(archivos.total, f.medida))}`)
          .join(", "),
    )
    .join(". ");

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
          {filas.map((f, i) => {
            const y = i * (ALTO + ENTRE);
            const total = valorDe(archivos.total, f.medida);
            const partes = tramos(
              GRUPOS.map((g) => ({ clave: g, valor: valorDe(archivos.porGrupo[g], f.medida) })),
              largo,
              { x0: COL_ROTULO },
            );
            return (
              <g key={f.rotulo}>
                <text className={styles.rotulo} x={0} y={y + 15}>
                  {f.rotulo}
                </text>
                {partes.length === 0 && <rect className={styles.grilla} x={COL_ROTULO} y={y} width={largo} height={ALTO} fill="none" rx={3} />}
                {partes.map((p) => (
                  <rect
                    key={p.clave}
                    className={styles.marca}
                    data-grupo={p.clave}
                    data-on={resaltado === p.clave || undefined}
                    x={p.x}
                    y={y}
                    width={p.w}
                    height={ALTO}
                    rx={Math.min(3, p.w / 2)}
                    style={{ fill: paleta.grupos[p.clave] }}
                    {...con(
                      {
                        titulo: NOMBRE_GRUPO[p.clave],
                        valor: f.medida === "bytes" ? textoDe(p.valor, "bytes") : `${textoDe(p.valor, "cantidad")} ${p.valor === 1 ? "archivo" : "archivos"}`,
                        nota: `${porcentaje(p.valor, total)} ${f.medida === "bytes" ? "del peso" : "de los archivos"}`,
                      },
                      (dentro) => onResaltar?.(dentro ? p.clave : null),
                    )}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {nodo}
    </div>
  );
}

/** Los cinco grupos con su color: la leyenda de `Proporcion` y de las barras por carpeta. */
export function Leyenda({ soloCon }: { soloCon?: ComposicionArchivos }) {
  const paleta = usePaletaGraficas();
  const grupos = soloCon ? GRUPOS.filter((g) => soloCon.porGrupo[g].cantidad > 0) : GRUPOS;
  return (
    <ul className={styles.leyenda} aria-label="Leyenda">
      {grupos.map((g) => (
        <li key={g}>
          <i style={{ background: paleta.grupos[g] }} aria-hidden />
          {NOMBRE_GRUPO[g]}
        </li>
      ))}
    </ul>
  );
}
