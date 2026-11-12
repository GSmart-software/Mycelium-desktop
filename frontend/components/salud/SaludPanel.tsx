"use client";

import { ExternalLink, Eye, EyeOff, FilePlus2, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { CurvaMeses, Leyenda, Proporcion } from "@/components/salud/graficas";
import type { RevisionVault } from "@/lib/estadisticasVault";
import { cuandoSeReviso, plural } from "@/lib/graficas";
import { entero, gravedades, pesoLegible } from "@/lib/informeSalud";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSaludStore } from "@/stores/saludStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useAbrirPestanaSalud, useGenerarInforme } from "./acciones";
import { ListaProblemas } from "./problemas";
import styles from "./SaludPanel.module.css";

/** Cuántas filas muestra cada clase de problema antes de «Ver todo»: el panel es angosto. */
const TOPE_PANEL = 5;

/**
 * El panel de salud del vault, en el rail (`FUN-L-30`, rehecho en `FUN-L-32`):
 * el resumen, las cifras clave, la composición (archivos y peso por grupo), los
 * problemas por gravedad —cada fila lleva a la nota y a la línea— y la curva de
 * notas nuevas. Desde su título se abre la pestaña con el tablero completo, se
 * genera el informe como nota o se vuelve a revisar.
 *
 * Revisa al abrirse (si la última revisión de este vault tiene más de un
 * minuto: `revisarSiHaceFalta`) y con «Volver a revisar». **Nunca** al guardar
 * ni de fondo, y en reposo no corre nada: sin relojes ni animaciones en bucle
 * (`DEF-174`). La revisión es la de `useSaludStore`, compartida con la pestaña.
 */
export function SaludPanel() {
  const vaultId = useVaultStore((s) => s.vaultId);
  const revision = useSaludStore((s) => (s.revisionVaultId === vaultId ? s.revision : null));
  const revisando = useSaludStore((s) => s.revisando);
  const error = useSaludStore((s) => s.errorRevision);
  const abrirPestana = useAbrirPestanaSalud();
  const { generando, generar } = useGenerarInforme(revision);
  const mostrarOcultas = usePreferencesStore((s) => s.prefs.saludMostrarOcultas === true);

  useEffect(() => {
    if (vaultId !== null) void useSaludStore.getState().revisarSiHaceFalta();
  }, [vaultId]);

  return (
    <div className={`mic-salud-panel ${styles.panel}`}>
      <div className={styles.cabecera}>
        <h2 className={styles.titulo}>Salud del vault</h2>
        <BotonIcono etiqueta="Abrir en una pestaña" onClick={abrirPestana}>
          <ExternalLink size={15} aria-hidden />
        </BotonIcono>
        <BotonIcono
          etiqueta={generando ? "Generando el informe…" : "Generar informe como nota"}
          onClick={() => void generar()}
          disabled={!revision || generando}
        >
          <FilePlus2 size={15} aria-hidden />
        </BotonIcono>
        <BotonIcono
          etiqueta={mostrarOcultas ? "Ocultar las carpetas que empiezan con punto" : "Mostrar las carpetas que empiezan con punto"}
          onClick={() => void useSaludStore.getState().alternarOcultas()}
          presionado={mostrarOcultas}
        >
          {mostrarOcultas ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
        </BotonIcono>
        <BotonIcono
          etiqueta={revisando ? "Revisando el vault…" : "Volver a revisar"}
          onClick={() => void useSaludStore.getState().revisar()}
          disabled={revisando}
        >
          <RefreshCw size={15} aria-hidden className={revisando ? styles.girando : undefined} />
        </BotonIcono>
      </div>

      {revision ? (
        <Contenido revision={revision} error={error} />
      ) : error && !revisando ? (
        <p className={styles.error} role="alert">
          No se pudo revisar el vault: {error}
        </p>
      ) : (
        <div className={styles.resumen} data-estado="cargando" role="status">
          <p className={styles.resumenTitulo}>{revisando ? "Revisando el vault…" : "Sin revisar"}</p>
        </div>
      )}

      <div className={styles.acciones}>
        <button type="button" className={styles.boton} onClick={abrirPestana}>
          <ExternalLink size={15} aria-hidden />
          Abrir en una pestaña
        </button>
        <button type="button" className={styles.boton} onClick={() => void generar()} disabled={!revision || generando}>
          <FilePlus2 size={15} aria-hidden />
          {generando ? "Generando…" : "Generar informe como nota"}
        </button>
      </div>
    </div>
  );
}

function Contenido({ revision, error }: { revision: RevisionVault; error: string | null }) {
  const { informe, estadisticas: e } = revision;
  const a = e.archivos;
  const g = gravedades(informe);
  const detalle = [
    plural(a.total.cantidad, "archivo", "archivos"),
    pesoLegible(a.total.bytes),
    `revisado ${cuandoSeReviso(revision.revisadoEn, new Date())}`,
  ].join(" · ");

  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          No se pudo volver a revisar el vault: {error}. Se muestra la revisión anterior.
        </p>
      )}

      <div className={styles.resumen} data-estado={g.total === 0 ? "sano" : "problemas"}>
        <p className={styles.resumenTitulo}>
          {g.total === 0 ? "Ningún problema" : plural(g.total, "problema", "problemas")}
          {g.graves > 0 && ` · ${plural(g.graves, "grave", "graves")}`}
        </p>
        <p className={styles.resumenDetalle}>{detalle}</p>
      </div>

      <div className={styles.cifras}>
        <Cifra valor={entero(a.porGrupo.notas.cantidad)} rotulo={a.porGrupo.notas.cantidad === 1 ? "nota" : "notas"} />
        <Cifra valor={entero(e.enlaces.total)} rotulo={e.enlaces.total === 1 ? "enlace" : "enlaces"} />
        <Cifra valor={entero(e.etiquetas.distintas)} rotulo={e.etiquetas.distintas === 1 ? "etiqueta" : "etiquetas"} />
      </div>

      <section className={styles.seccion} aria-labelledby="salud-panel-composicion">
        <h3 id="salud-panel-composicion" className={styles.seccionTitulo}>
          Composición
        </h3>
        <Proporcion archivos={a} />
        {a.total.cantidad > 0 && <Leyenda soloCon={a} />}
      </section>

      <section className={styles.seccion} aria-labelledby="salud-panel-problemas">
        <h3 id="salud-panel-problemas" className={styles.seccionTitulo}>
          Problemas
        </h3>
        <ListaProblemas informe={informe} tope={TOPE_PANEL} />
      </section>

      <section className={styles.seccion} aria-labelledby="salud-panel-crecimiento">
        <h3 id="salud-panel-crecimiento" className={styles.seccionTitulo}>
          Notas nuevas, 12 meses
        </h3>
        {e.crecimiento.confiable ? (
          <CurvaMeses meses={e.crecimiento.meses} />
        ) : (
          <p className={styles.aviso}>
            Muchas notas entraron al índice de una vez: sus fechas no dicen cuándo se escribieron. Las que se creen desde
            ahora sí van a contar.
          </p>
        )}
      </section>
    </>
  );
}

function Cifra({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className={styles.cifra}>
      <b>{valor}</b>
      <span>{rotulo}</span>
    </div>
  );
}

function BotonIcono({
  etiqueta,
  onClick,
  disabled,
  presionado,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
  /** Un botón que alterna (`aria-pressed`); ausente, es un botón común. */
  presionado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.icono}
      onClick={onClick}
      disabled={disabled}
      title={etiqueta}
      aria-label={etiqueta}
      aria-pressed={presionado}
    >
      {children}
    </button>
  );
}
