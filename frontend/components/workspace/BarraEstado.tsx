"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EVENTO_RECARGA } from "@/lib/eventos";
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

  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [revision, setRevision] = useState(0);

  // Las conexiones cambian al guardar (un enlace nuevo) o cuando el vault
  // cambia por fuera (otra nota empieza a citar a esta).
  useEffect(() => {
    const onRecarga = () => setRevision((r) => r + 1);
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    return () => window.removeEventListener(EVENTO_RECARGA, onRecarga);
  }, []);

  useEffect(() => {
    if (!esNota || !notaId) {
      setConteo(null);
      return;
    }
    let cancelado = false;
    void api<{ nota: { actualizadoEn: string }; salientes: unknown[]; retro: unknown[] }>(
      `/notas/${encodeURIComponent(notaId)}/conexiones`,
      { token: useAuthStore.getState().accessToken },
    )
      .then((c) => {
        if (cancelado) return;
        const modificada = Date.parse(c.nota.actualizadoEn);
        setConteo({
          salientes: c.salientes.length,
          retro: c.retro.length,
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
      : estado === "error" || estado === "offline"
        ? "Sin guardar"
        : ultimo
          ? `Guardado ${hora(ultimo)}`
          : "Guardado";

  return (
    <footer className={styles.barra} aria-label="Barra de estado">
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
          {palabras !== undefined && (
            <span className={styles.item}>{plural(palabras, "palabra", "palabras")}</span>
          )}
          {/* Sin role="status": cada tecla pasa por «Guardando…» y un lector de
              pantalla lo anunciaría todo el tiempo. */}
          <span
            className={estado === "error" || estado === "offline" ? `${styles.item} ${styles.alerta}` : styles.item}
          >
            {guardado}
          </span>
        </>
      )}
    </footer>
  );
}
