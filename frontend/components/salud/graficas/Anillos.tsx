"use client";

import { GRUPOS, NOMBRE_GRUPO, RAIZ, type ComposicionArchivos, type RedVault } from "@/lib/estadisticas";
import {
  acortar,
  arcoAnillo,
  filasComposicion,
  polar,
  rotuloExterior,
  sectores,
  textoDe,
  valorDe,
  type Medida,
} from "@/lib/graficas";
import { entero, porcentaje } from "@/lib/informeSalud";
import { usePaletaGraficas } from "@/lib/usePaletaGraficas";
import { EstadoVacio, type Resaltado } from "./comun";
import styles from "./graficas.module.css";
import { useTooltip } from "./Tooltip";
import { useAncho } from "./useAncho";

/** Radio exterior de referencia: las demás medidas son proporciones de este. */
const REF = 176;
/** Margen a cada lado para los nombres de las carpetas. */
const MARGEN_ROTULOS = 64;
/** Un nombre de carpeta va por fuera solo si su sector es más ancho que esto. */
const SECTOR_CON_ROTULO = 0.3;

/**
 * Los anillos de «Qué hay en el vault»: los grupos de tipo adentro, las
 * carpetas de primer nivel afuera (teñidas con el grupo que más pesa en cada
 * una, mezclado con la superficie) y, en el centro, el total y el porcentaje
 * de notas conectadas rodeado de un arco de ese porcentaje.
 */
export function Anillos({
  archivos,
  red,
  medida,
  resaltado = null,
  onResaltar,
}: { archivos: ComposicionArchivos; red: RedVault; medida: Medida } & Resaltado) {
  const paleta = usePaletaGraficas();
  const { ref, ancho } = useAncho();
  const { con, nodo } = useTooltip();
  const total = valorDe(archivos.total, medida);

  if (archivos.total.cantidad === 0 || total === 0) {
    return (
      <div ref={ref} className={styles.contenedor}>
        <EstadoVacio texto={archivos.total.cantidad === 0 ? "El vault todavía no tiene archivos." : "Los archivos del vault no pesan nada todavía."} />
      </div>
    );
  }

  const conRotulos = ancho >= 340;
  const rExt = Math.max(60, Math.min(190, (ancho - 2 * (conRotulos ? MARGEN_ROTULOS : 8)) / 2));
  const k = rExt / REF;
  const alto = Math.ceil(2 * rExt + 32);
  const cx = ancho / 2;
  const cy = alto / 2;
  const r = (n: number) => n * k;

  const internos = sectores(
    GRUPOS.map((g) => ({ clave: g, valor: valorDe(archivos.porGrupo[g], medida) })),
    r(118),
  );
  const externos = sectores(
    archivos.carpetas.map((c) => ({ clave: c, valor: valorDe(c, medida) })),
    r(162),
  );
  const filas = filasComposicion(archivos, medida);
  const deQue = medida === "bytes" ? "del peso" : "de los archivos";
  const etiqueta =
    `Composición del vault por ${medida === "bytes" ? "peso" : "cantidad de archivos"}: ` +
    filas.filter((f) => f.valor > 0).map((f) => `${f.nombre} ${f.texto} (${f.porcentaje})`).join(", ") +
    `. Anillo exterior: ${archivos.carpetas.length} ${archivos.carpetas.length === 1 ? "carpeta" : "carpetas"} de primer nivel.` +
    ` ${porcentaje(red.conectadas, red.notas)} de las notas están conectadas.`;

  const pct = red.notas > 0 ? red.conectadas / red.notas : 0;
  const rCentro = r(70);

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
          {internos.map((s) => (
            <path
              key={s.clave}
              className={styles.marca}
              data-grupo={s.clave}
              data-on={resaltado === s.clave || undefined}
              d={arcoAnillo(cx, cy, r(96), r(140), s.a0, s.a1)}
              style={{ fill: paleta.grupos[s.clave] }}
              {...con(
                {
                  titulo: NOMBRE_GRUPO[s.clave],
                  valor: `${entero(archivos.porGrupo[s.clave].cantidad)} ${archivos.porGrupo[s.clave].cantidad === 1 ? "archivo" : "archivos"} · ${textoDe(archivos.porGrupo[s.clave].bytes, "bytes")}`,
                  nota: `${porcentaje(s.valor, total)} ${deQue}`,
                },
                (dentro) => onResaltar?.(dentro ? s.clave : null),
              )}
            />
          ))}
          {externos.map((s) => {
            const c = s.clave;
            const nombre = c.carpeta === RAIZ ? "Raíz del vault" : `${c.carpeta}/`;
            return (
              <path
                key={c.carpeta}
                className={styles.marca}
                d={arcoAnillo(cx, cy, r(148), r(176), s.a0, s.a1)}
                style={{ fill: `color-mix(in srgb, ${paleta.grupos[c.grupoMayor]} 45%, var(--mic-bg-surface))` }}
                {...con({
                  titulo: nombre,
                  valor: `${entero(c.cantidad)} ${c.cantidad === 1 ? "archivo" : "archivos"} · ${textoDe(c.bytes, "bytes")}`,
                  nota: `${porcentaje(s.valor, total)} ${deQue} · sobre todo ${NOMBRE_GRUPO[c.grupoMayor].toLowerCase()}`,
                })}
              />
            );
          })}
          {conRotulos &&
            externos
              .filter((s) => s.a1 - s.a0 > SECTOR_CON_ROTULO)
              .map((s) => {
                const p = rotuloExterior(cx, cy, rExt + 12, s);
                return (
                  <text key={`r-${s.clave.carpeta}`} x={p.x} y={p.y} textAnchor={p.ancla}>
                    {acortar(s.clave.carpeta, 14)}
                  </text>
                );
              })}
          {/* Las hifas del centro: el motivo de la marca, estático. */}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2 + 0.25;
            const [x0, y0] = polar(cx, cy, r(64) + 4, a);
            const [qx, qy] = polar(cx, cy, r(80) + 2, a + 0.2);
            const [x1, y1] = polar(cx, cy, r(92), a + 0.06);
            return <path key={`h-${i}`} className={styles.hifa} d={`M${x0},${y0} Q${qx},${qy} ${x1},${y1}`} aria-hidden />;
          })}
          <circle className={styles.centro} cx={cx} cy={cy} r={rCentro} />
          {pct > 0 && (
            <circle
              className={styles.arcoConectadas}
              cx={cx}
              cy={cy}
              r={rCentro}
              strokeDasharray={`${pct * 2 * Math.PI * rCentro} ${2 * Math.PI * rCentro}`}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )}
          <text className={styles.centroTotal} x={cx} y={cy - r(8)} textAnchor="middle" style={{ fontSize: Math.max(15, 24 * k) }}>
            {textoDe(total, medida)}
          </text>
          <text x={cx} y={cy + r(12)} textAnchor="middle">
            {medida === "bytes" ? "en disco" : archivos.total.cantidad === 1 ? "archivo" : "archivos"}
          </text>
          {red.notas > 0 && k > 0.6 && (
            <text className={styles.centroPie} x={cx} y={cy + r(32)} textAnchor="middle" style={{ fontSize: Math.min(11.5, 13 * k) }}>
              {porcentaje(red.conectadas, red.notas)} conectadas
            </text>
          )}
        </svg>
      )}
      {nodo}
    </div>
  );
}
