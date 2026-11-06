"use client";

import { navegarFilas } from "@/lib/teclado/listaDom";
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
import { agruparPorSesion, hace, venceEn, vigentes, type GrupoActividad } from "@/lib/sesionesIa";
import { useSesionesIaStore } from "@/stores/sesionesIaStore";
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
 *
 * Desde `FUN-L-31`, la cabecera lista las sesiones de IA conectadas (su tarea
 * y sus reservas) y el registro se agrupa por sesión, bajo su tarea.
 */
export function ActividadPanel() {
  const entradas = useActividadIaStore((s) => s.entradas);
  const sesiones = useSesionesIaStore((s) => s.sesiones);
  const vista = useMemo(() => vistaActividad(entradas), [entradas]);
  const grupos = useMemo(() => agruparPorSesion(vista, sesiones), [vista, sesiones]);
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
          del vault— aparece aquí, con <strong>Deshacer</strong> donde se pueda.
        </p>
      ) : (
        <div
          className={styles.grupos}
          // ↑ ↓ entre las entradas, ← → entre sus botones (`FUN-XL-04`, Parte 7).
          onKeyDown={(e) => navegarFilas(e, e.currentTarget, "li")}
        >
          {grupos.map((g) => (
            <Grupo key={g.clave} grupo={g} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Un grupo: lo que hizo una sesión ────────────────────────────────────────

function Grupo({ grupo: g }: { grupo: GrupoActividad }) {
  const titulo = g.sesion === null ? "Sin sesión identificada" : (g.tarea ?? "Sin tarea declarada");
  return (
    <section className={styles.grupo} aria-label={`${titulo}: lo que hizo, de lo más nuevo a lo más viejo`}>
      <header className={styles.grupoCabecera}>
        <span className={styles.grupoTarea} data-sin-tarea={g.sesion !== null && g.tarea === null ? true : undefined}>
          {titulo}
        </span>
        {g.sesion !== null && (
          <span className={styles.grupoMeta} title={g.conectada ? "La sesión sigue conectada" : "La sesión ya terminó"}>
            {g.sesion}
            {g.conectada ? " · conectada" : ""}
          </span>
        )}
      </header>
      <ul className={styles.lista}>
        {g.entradas.map((e) => (
          <Fila key={e.id} entrada={e} />
        ))}
      </ul>
    </section>
  );
}

// ── Las sesiones conectadas ─────────────────────────────────────────────────

function Sesiones({ ahora }: { ahora: number }) {
  const sesiones = useSesionesIaStore((s) => s.sesiones);
  const reservas = useSesionesIaStore((s) => s.reservas);
  const lista = useMemo(() => Object.values(sesiones).sort((a, b) => a.inicio - b.inicio), [sesiones]);
  if (lista.length === 0) return null;
  const vivas = vigentes(reservas, ahora);
  return (
    <ul className={styles.sesiones} aria-label="Sesiones de IA conectadas">
      {lista.map((s) => {
        const suyas = vivas.filter((r) => r.sesion === s.id);
        return (
          <li key={s.id} className={styles.sesion}>
            <span className={styles.sesionTarea} data-sin-tarea={s.tarea === null ? true : undefined}>
              {s.tarea ?? "Sin tarea declarada"}
            </span>
            <span className={styles.sesionMeta}>
              {s.id} · conectada {hace(ahora - s.inicio)}
              {s.ultimaActividad !== null ? ` · habló ${hace(ahora - s.ultimaActividad)}` : ""}
            </span>
            {suyas.length > 0 && (
              <span className={styles.sesionReservas}>
                Reservó:{" "}
                {suyas.map((r, i) => (
                  <span key={r.objetivo.ruta} title={`«${r.motivo}» · ${venceEn(r.vence - ahora)}`}>
                    {i > 0 ? ", " : ""}
                    {r.objetivo.ruta}
                    {r.objetivo.clase === "carpeta" ? "/" : ""}
                  </span>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── El canal ────────────────────────────────────────────────────────────────

const TEXTO_CANAL: Record<EstadoCanal, { titulo: string; detalle: string }> = {
  apagado: {
    titulo: "Control apagado",
    detalle: "Claude Code no puede operar Mycelium en este vault. Leer y escribir sus archivos lo puede hacer de todos modos.",
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
  const conectadas = useSesionesIaStore((s) => Object.keys(s.sesiones).length);
  const [tic, setTic] = useState(() => Date.now());
  const [cambiando, setCambiando] = useState(false);

  // «Conectado» vence solo: se recalcula cada medio minuto. Un pedido nuevo
  // es más reciente que el último tic, así que cuenta como «ahora». De paso se
  // olvida lo vencido (reservas, sesiones que nunca se anunciaron).
  useEffect(() => {
    const t = window.setInterval(() => {
      setTic(Date.now());
      useSesionesIaStore.getState().podar();
    }, 30_000);
    return () => window.clearInterval(t);
  }, []);
  const ahora = Math.max(tic, ultimoPedido ?? 0);

  const estado = estadoCanal(encendido, errorCanal, ultimoPedido, ahora, conectadas);
  const { titulo } = TEXTO_CANAL[estado];
  const detalle =
    estado === "conectado" && conectadas > 0
      ? conectadas === 1
        ? "Una sesión de Claude Code conectada."
        : `${conectadas} sesiones de Claude Code conectadas.`
      : estado === "conectado" && ultimoPedido !== null
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
      {estado === "conectado" && <Sesiones ahora={ahora} />}
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
