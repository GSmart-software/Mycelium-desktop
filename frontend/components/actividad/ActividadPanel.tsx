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
import { describir, esDelDiccionario, motivoSinDeshacer } from "@/lib/deshacerIa";
import { CALENDAR_TAB_ID, GRAPH_TAB_ID } from "@/lib/pestanas";
import { fechaLocal, horaLocal } from "@/lib/recordatorios";
import { useActividadIaStore } from "@/stores/actividadIaStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
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
  // Para saber si lo borrado sigue en la papelera (el Deshacer de un borrar).
  useEffect(() => {
    void useVaultStore.getState().loadPapelera().catch(() => {});
  }, []);

  return (
    <div className={styles.panel}>
      <Canal />
      {vista.length === 0 ? (
        <p className={styles.vacio}>
          Todavía no hay actividad. Lo que Claude Code haga en Mycelium —abrir notas, agendar o cambiar
          recordatorios, renombrar, mover o mandar a la papelera, agregar o quitar palabras del diccionario
          del vault— aparece acá, con <strong>Deshacer</strong> donde se pueda.
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

/**
 * Las palabras del diccionario del vault, al día: el Deshacer de un agregar o
 * un quitar de la IA se apaga si después alguien las cambió. Solo se lee si la
 * entrada lo necesita (`activo`); `null` mientras no se leyó.
 */
function usePalabrasDelVault(activo: boolean): ReadonlySet<string> | null {
  const [palabras, setPalabras] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    let baja: (() => void) | null = null;
    void import("@/lib/ortografia/corrector").then((c) => {
      if (!vivo) return;
      const cargar = () =>
        c
          .palabrasDe("vault")
          .then((p) => vivo && setPalabras(new Set(p)))
          .catch(() => {});
      void cargar();
      baja = c.suscribirPersonales(() => void cargar());
    });
    return () => {
      vivo = false;
      baja?.();
    };
  }, [activo]);
  return activo ? palabras : null;
}

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
  const [deshaciendo, setDeshaciendo] = useState(false);
  // Se recalcula con el calendario y el vault: si lo que dejó la operación
  // cambió después, deshacer pisaría ese cambio, así que el botón queda
  // deshabilitado con el motivo.
  const archivoCal = useRecordatoriosStore((s) => s.archivo);
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);
  const papelera = useVaultStore((s) => s.papelera);
  const diccionario = usePalabrasDelVault(!deshecha && e.deshacer !== undefined && esDelDiccionario(e.deshacer));
  const motivoNo = useMemo(() => {
    if (!e.deshacer || deshecha) return null;
    return motivoSinDeshacer(
      e.deshacer,
      archivoCal,
      {
        notas: new Set(notas.map((n) => n.id)),
        carpetas: new Set(carpetas.map((c) => c.id)),
        papelera: new Set(papelera.map((p) => p.notaId)),
      },
      diccionario,
    );
  }, [e.deshacer, deshecha, archivoCal, notas, carpetas, papelera, diccionario]);

  const ir = (o: Objetivo) => {
    const tabs = useTabsStore.getState();
    if (o.tipo === "papelera") {
      const layout = usePanelLayoutStore.getState();
      if (layout.activeSection !== "trash") layout.toggleSection("trash");
      return;
    }
    if (o.tipo === "carpeta") {
      const { carpetas: todas } = useVaultStore.getState();
      if (!todas.some((c) => c.id === o.ruta)) {
        avisar(`La carpeta «${o.ruta}» ya no existe (puede haberse renombrado, movido o borrado).`);
        return;
      }
      // Desplegar la carpeta y las de arriba, y mostrar el explorador.
      const expandir: Record<string, boolean> = {};
      const partes = o.ruta.split("/");
      for (let i = 1; i <= partes.length; i++) expandir[partes.slice(0, i).join("/")] = true;
      useVaultStore.setState((s) => ({ expanded: { ...s.expanded, ...expandir } }));
      const layout = usePanelLayoutStore.getState();
      if (layout.activeSection !== "explorer") layout.toggleSection("explorer");
      return;
    }
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
    setDeshaciendo(true);
    try {
      const { deshacerEntrada } = await import("@/lib/deshacerIa");
      const r = await deshacerEntrada(e);
      avisar(r.ok ? `Deshecho: ${r.texto}` : r.texto);
    } finally {
      setDeshaciendo(false);
    }
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
              title={motivoNo ? `No se puede deshacer: ${motivoNo}` : `Deshacer: ${describir(e.deshacer)}`}
              disabled={motivoNo !== null || deshaciendo}
              onClick={() => void deshacer()}
            >
              {deshaciendo ? "Deshaciendo…" : "Deshacer"}
            </button>
          )}
        </div>
      )}
      {motivoNo && e.resultado === "hecho" && <p className={styles.sinDeshacer}>No se puede deshacer: {motivoNo}.</p>}
    </li>
  );
}
