"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  NOMBRE_OP,
  estadoCanal,
  vistaActividad,
  type EntradaVista,
  type EstadoCanal,
  type Objetivo,
} from "@/lib/actividadIa";
import { describirDeshacer } from "@/lib/mcpCalendarioLogica";
import { CALENDAR_TAB_ID, GRAPH_TAB_ID } from "@/lib/pestanas";
import { fechaLocal, horaLocal } from "@/lib/recordatorios";
import { useActividadIaStore } from "@/stores/actividadIaStore";
import { avisar } from "@/stores/avisosStore";
import { usePrefsVaultStore } from "@/stores/prefsVaultStore";
import { useRecordatoriosStore } from "@/stores/recordatoriosStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./ActividadPanel.module.css";

/**
 * El registro de actividad de la IA (`FUN-L-09`, Parte 2; spec en
 * `docs/features/mcp-control.md` § 2.3): lo que hizo Claude Code por el MCP de
 * control —operación, momento, efecto—, con «Ir» a lo afectado, «Deshacer»
 * donde se puede, lo que falló, y arriba el estado del canal.
 *
 * Es lo que permite que lo reversible no pregunte: se ve y se deshace acá.
 */
export function ActividadPanel() {
  const entradas = useActividadIaStore((s) => s.entradas);
  const vista = useMemo(() => vistaActividad(entradas), [entradas]);

  return (
    <div className={styles.panel}>
      <Canal />
      {vista.length === 0 ? (
        <p className={styles.vacio}>
          Todavía no hay actividad. Lo que Claude Code haga en Mycelium —abrir notas, agendar o cambiar
          recordatorios— aparece acá, con <strong>Deshacer</strong> donde se pueda.
        </p>
      ) : (
        <ul className={styles.lista} aria-label="Lo que hizo la IA, de lo más nuevo a lo más viejo">
          {vista.map((e) => (
            <Fila key={e.id} entrada={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── El canal ────────────────────────────────────────────────────────────────

const TEXTO_CANAL: Record<EstadoCanal, { titulo: string; detalle: string }> = {
  apagado: {
    titulo: "Control apagado",
    detalle: "Claude Code no puede operar Mycelium en este vault. Leer y escribir sus archivos lo puede hacer igual.",
  },
  encendido: {
    titulo: "Control encendido",
    detalle: "Esperando a Claude Code: lo toma al abrir una sesión nueva en este vault.",
  },
  conectado: { titulo: "Conectado", detalle: "" },
  error: { titulo: "El canal no se abrió", detalle: "" },
};

function haceCuanto(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace un momento";
  return min === 1 ? "hace 1 minuto" : `hace ${min} minutos`;
}

function Canal() {
  const encendido = usePrefsVaultStore((s) => s.prefs.controlIa);
  const errorCanal = useActividadIaStore((s) => s.errorCanal);
  const ultimoPedido = useActividadIaStore((s) => s.ultimoPedido);
  const ruta = useVaultSessionStore((s) => s.rutaActual);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [tic, setTic] = useState(() => Date.now());
  const [cambiando, setCambiando] = useState(false);

  // «Conectado» vence solo: se recalcula cada medio minuto. Un pedido nuevo
  // es más reciente que el último tic, así que cuenta como «ahora».
  useEffect(() => {
    const t = window.setInterval(() => setTic(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const ahora = Math.max(tic, ultimoPedido ?? 0);

  const estado = estadoCanal(encendido, errorCanal, ultimoPedido, ahora);
  const { titulo } = TEXTO_CANAL[estado];
  const detalle =
    estado === "conectado" && ultimoPedido !== null
      ? `Claude Code habló ${haceCuanto(ahora - ultimoPedido)}.`
      : estado === "error"
        ? (errorCanal ?? "")
        : TEXTO_CANAL[estado].detalle;

  const encender = async () => {
    if (!ruta) return;
    setCambiando(true);
    try {
      const { cambiarControl } = await import("@/lib/mcpControl");
      avisar(await cambiarControl(ruta, true));
    } catch (e) {
      avisar(`No se pudo encender el control: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setCambiando(false);
    }
  };

  return (
    <section className={styles.canal} data-estado={estado} aria-live="polite">
      <p className={styles.canalTitulo}>
        <span className={styles.punto} aria-hidden />
        {titulo}
      </p>
      {detalle && <p className={styles.canalDetalle}>{detalle}</p>}
      {(estado === "apagado" || estado === "error") && (
        <div className={styles.acciones}>
          <button type="button" className={styles.boton} onClick={() => void encender()} disabled={cambiando || !ruta}>
            {estado === "apagado" ? (cambiando ? "Encendiendo…" : "Encender") : cambiando ? "Reintentando…" : "Reintentar"}
          </button>
          <button type="button" className={styles.botonSecundario} onClick={() => setSettingsOpen(true)}>
            Configuración
          </button>
        </div>
      )}
    </section>
  );
}

// ── Una entrada ─────────────────────────────────────────────────────────────

/** «10:42», «ayer 10:42» o «3 oct 10:42», en la hora local. */
function momentoCorto(iso: string): string {
  const d = new Date(iso);
  const hoy = fechaLocal(new Date());
  const dia = fechaLocal(d);
  const hora = horaLocal(d);
  if (dia === hoy) return hora;
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  if (dia === fechaLocal(ayer)) return `ayer ${hora}`;
  return `${d.toLocaleDateString("es", { day: "numeric", month: "short" })} ${hora}`;
}

const ETIQUETA_RESULTADO = { fallo: "Falló", rechazado: "Rechazado" } as const;

function Fila({ entrada: e }: { entrada: EntradaVista }) {
  const router = useRouter();
  const deshecha = e.deshechaEn !== null;

  const ir = (o: Objetivo) => {
    const tabs = useTabsStore.getState();
    if (o.tipo === "recordatorio") {
      if (!useRecordatoriosStore.getState().archivo.recordatorios.some((r) => r.id === o.id)) {
        avisar("Ese recordatorio ya no está en el calendario.");
        return;
      }
      useRecordatoriosStore.getState().enfocar(o.fecha, o.id);
    }
    const id =
      o.tipo === "nota" ? o.ruta : o.tipo === "grafo" ? GRAPH_TAB_ID : CALENDAR_TAB_ID;
    if (o.tipo === "nota" && !useVaultStore.getState().notas.some((n) => n.id === o.ruta)) {
      avisar(`«${o.ruta}» ya no existe (puede haberse renombrado o borrado).`);
      return;
    }
    tabs.openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  };

  const deshacer = async () => {
    const { deshacerEntrada } = await import("@/lib/mcpCalendario");
    const r = deshacerEntrada(e);
    avisar(r.ok ? `Deshecho: ${r.texto}` : r.texto);
  };

  return (
    <li className={styles.fila} data-resultado={e.resultado} data-deshecha={deshecha || undefined}>
      <p className={styles.cabecera}>
        <span className={styles.op}>{NOMBRE_OP[e.op] ?? e.op}</span>
        {e.resultado !== "hecho" && (
          <span className={styles.marca}>
            {ETIQUETA_RESULTADO[e.resultado]}
            {e.codigo ? ` · ${e.codigo}` : ""}
          </span>
        )}
        <time className={styles.momento} dateTime={e.momento}>
          {momentoCorto(e.momento)}
        </time>
      </p>
      <p className={styles.efecto}>{e.efecto}</p>
      {deshecha && <p className={styles.deshecho}>Deshecho a las {horaLocal(new Date(e.deshechaEn!))}.</p>}
      {e.resultado === "hecho" && (e.objetivo || (e.deshacer && !deshecha)) && (
        <div className={styles.acciones}>
          {e.objetivo && !deshecha && (
            <button type="button" className={styles.botonSecundario} onClick={() => ir(e.objetivo!)}>
              Ir
            </button>
          )}
          {e.deshacer && !deshecha && (
            <button
              type="button"
              className={styles.boton}
              title={`Deshacer: ${describirDeshacer(e.deshacer)}`}
              onClick={() => void deshacer()}
            >
              Deshacer
            </button>
          )}
        </div>
      )}
    </li>
  );
}
