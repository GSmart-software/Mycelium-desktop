"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ConteoConexionesDto } from "@/lib/db/grafo";
import { nextDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { resumenDiagnosticos } from "@/lib/diagnosticos";
import { useDiagnosticos } from "@/lib/diagnosticosVault";
import { getView } from "@/lib/editor/viewRegistry";
import { alternarGrabacion } from "@/lib/comandos/comandosMacros";
import { useMacros } from "@/lib/comandos/preferenciasMacros";
import { EVENTO_NOTA_GUARDADA, EVENTO_RECARGA } from "@/lib/eventos";
import { useAuthStore } from "@/stores/authStore";
import { useSyncStore } from "@/stores/syncStore";
import { panelMetaAbierto, useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { IconoGrafo } from "./IconoGrafo";
import styles from "./BarraEstado.module.css";

/**
 * Barra de estado al pie del workspace (rediseño del cascarón, 2026-09-19),
 * como la de VS Code y Obsidian: lo que se quiere saber de la nota activa sin
 * abrir nada. «12 enlaces · 5 te citan · 843 palabras · guardado 14:02».
 *
 * Los enlaces se cuentan acá y el panel de enlaces arranca cerrado: un clic en
 * los números lo abre. Reemplaza al punto de color de la barra del editor, que
 * decía «guardado» solo con un color y un tooltip.
 */

type Conteo = { salientes: number; retro: number; modificadaEn: number | null };

/** «14:02» si fue hoy; si no, «12 sept.»: una hora sola de otro día engaña. */
const hora = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function BarraEstado() {
  const { grabacion } = useMacros();
  const notaId = useTabsStore((s) => s.activeNotaId());
  const paneId = useTabsStore((s) => s.activePaneId);
  const panelAbierto = useTabsStore((s) => panelMetaAbierto(s.root, s.activePaneId));
  // Solo las notas de texto tienen enlaces y palabras; el grafo, una consola o
  // un lienzo dejan la barra vacía (no se inventan ceros).
  const esNota = useVaultStore(
    (s) => !!notaId && s.notas.some((n) => n.id === notaId && n.tipo === "markdown"),
  );
  const estado = useSyncStore((s) => (notaId ? s.byNota[notaId] : undefined));
  const guardadoEn = useSyncStore((s) => (notaId ? s.guardadoEn[notaId] : undefined));
  const palabras = useSyncStore((s) => (notaId ? s.palabras[notaId] : undefined));
  // Diagnósticos de la nota (`FUN-M-44`): solo si hay alguno.
  const diagnosticos = useDiagnosticos(esNota ? notaId : null)?.diagnosticos ?? [];

  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [revision, setRevision] = useState(0);

  // Las conexiones cambian al guardar (un enlace nuevo) o cuando el vault
  // cambia por fuera (otra nota empieza a citar a esta). El guardado se oye por
  // su propio evento: el watcher ya no reacciona a lo que escribe la app
  // (`FUN-M-38`), así que `EVENTO_RECARGA` solo llega por cambios de afuera.
  useEffect(() => {
    const onRecarga = () => setRevision((r) => r + 1);
    const onGuardada = (e: Event) => {
      if ((e as CustomEvent<{ notaId?: string }>).detail?.notaId === notaId) onRecarga();
    };
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    window.addEventListener(EVENTO_NOTA_GUARDADA, onGuardada);
    return () => {
      window.removeEventListener(EVENTO_RECARGA, onRecarga);
      window.removeEventListener(EVENTO_NOTA_GUARDADA, onGuardada);
    };
  }, [notaId]);

  useEffect(() => {
    if (!esNota || !notaId) {
      setConteo(null);
      return;
    }
    let cancelado = false;
    // Solo los dos números y la fecha, en una consulta que no lee contenido
    // (`FUN-M-58`). Antes se pedían las `conexiones` enteras —con el texto de
    // cada nota que cita, para fragmentos que la barra no muestra— en cada
    // guardado: hasta 1,7 MB cada 10 s en una nota muy citada.
    void api<ConteoConexionesDto>(`/notas/${encodeURIComponent(notaId)}/conteo-conexiones`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((c) => {
        if (cancelado) return;
        const modificada = Date.parse(c.actualizadoEn);
        setConteo({
          salientes: c.salientes,
          retro: c.retro,
          modificadaEn: Number.isNaN(modificada) ? null : modificada,
        });
      })
      .catch(() => !cancelado && setConteo(null));
    return () => {
      cancelado = true;
    };
  }, [esNota, notaId, guardadoEn, revision]);

  // La hora es la del último guardado de esta sesión o, si todavía no se
  // guardó nada, la de la última modificación del archivo: así hay hora desde
  // que se abre la nota.
  const ultimo = guardadoEn ?? conteo?.modificadaEn ?? undefined;
  const guardado =
    estado === "local" || estado === "syncing"
      ? "Guardando…"
      : estado === "error"
        ? "Sin guardar"
        : estado === "conflicto"
          ? // `DEF-138`: el guardado está en pausa hasta que se elija en la barra
            // de la nota; decir «Guardando…» sería mentir.
            "Sin guardar: conflicto"
        : ultimo
          ? `Guardado ${hora(ultimo)}`
          : "Guardado";

  return (
    <footer className={styles.barra} aria-label="Barra de estado" data-zona="estado">
      {grabacion && (
        // Mientras se graba una macro (`FUN-XL-04`, Parte 6): se ve siempre, y
        // pulsarla detiene la grabación.
        <button
          type="button"
          className={`${styles.item} ${styles.grabando} mic-grabando-macro`}
          title="Detener la grabación y guardarla como macro"
          onClick={alternarGrabacion}
        >
          <span className={styles.punto} aria-hidden />
          Grabando macro · {plural(grabacion.length, "paso", "pasos")}
        </button>
      )}
      {esNota && (
        <>
          {conteo && (
            // Va a la IZQUIERDA y con el isotipo: es lo único pulsable de la
            // barra y en reposo se leía igual que «1420 palabras», así que el
            // clic solo se descubría por accidente (crítica del cascarón).
            <button
              type="button"
              className={styles.item + " " + styles.enlaces}
              aria-pressed={panelAbierto}
              title="Panel de enlaces (Ctrl+Shift+\)"
              onClick={() => useTabsStore.getState().togglePanelMeta(paneId)}
            >
              <IconoGrafo size={12} />
              {plural(conteo.salientes, "enlace", "enlaces")} ·{" "}
              {conteo.retro === 1 ? "1 te cita" : `${conteo.retro} te citan`}
            </button>
          )}
          {diagnosticos.length > 0 && (
            <button
              type="button"
              className={`${styles.item} ${styles.avisos}`}
              title="Ir al siguiente aviso de la nota"
              onClick={() => {
                const view = getView(paneId);
                if (!view) return;
                nextDiagnostic(view);
                // DEF-179: `nextDiagnostic` desplaza lo mínimo (`scrollIntoView: true`)
                // y la línea del aviso quedaba pegada al borde de abajo. Se centra,
                // como los demás saltos del editor (DEF-056).
                view.dispatch({
                  effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
                });
                view.focus();
              }}
            >
              {resumenDiagnosticos(diagnosticos.length)}
            </button>
          )}
          {palabras !== undefined && (
            <span className={styles.item}>{plural(palabras, "palabra", "palabras")}</span>
          )}
          {/* Sin role="status": cada tecla pasa por «Guardando…» y un lector de
              pantalla lo anunciaría todo el tiempo. */}
          <span
            className={
              estado === "error" || estado === "conflicto" ? `${styles.item} ${styles.alerta}` : styles.item
            }
          >
            {guardado}
          </span>
        </>
      )}
    </footer>
  );
}
