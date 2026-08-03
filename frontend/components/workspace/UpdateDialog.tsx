"use client";

import { ArrowDownToLine, TriangleAlert } from "lucide-react";
import { useEffect, useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { EVENTO_PROGRESO, fechaLegible, type ProgresoDescarga } from "@/lib/updater";
import { useUpdaterStore } from "@/stores/updaterStore";
import styles from "./UpdateDialog.module.css";

/** Tamaño en MB con un decimal (los instaladores rondan los 9 MB). */
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Diálogo de actualización (`FUN-L-14`).
 *
 * Tres salidas: **Actualizar** (descarga con progreso, instala y reinicia),
 * **Más tarde** (mañana se vuelve a ofrecer) y **Omitir esta versión** (no se
 * menciona más ESA versión). Las notas de la release se renderizan con el motor
 * de Mycelium, no como texto plano: es el mismo Markdown que el usuario ve en
 * sus notas y sale gratis.
 *
 * No roba el foco ni interrumpe: se monta cuando la app ya está usable, y
 * mientras descarga se puede seguir trabajando (la instalación, que cierra la
 * app, solo ocurre al confirmarla).
 */
export function UpdateDialog() {
  const fase = useUpdaterStore((s) => s.fase);
  const oferta = useUpdaterStore((s) => s.oferta);
  const progreso = useUpdaterStore((s) => s.progreso);
  const error = useUpdaterStore((s) => s.error);
  const esBajada = useUpdaterStore((s) => s.esBajada);

  // Progreso de la descarga: lo emite Rust mientras baja el paquete.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let vigente = true;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<ProgresoDescarga>(EVENTO_PROGRESO, (e) => {
        useUpdaterStore.getState().setProgreso(e.payload);
      }).then((unlisten) => {
        if (vigente) dispose = unlisten;
        else unlisten();
      }),
    );
    return () => {
      vigente = false;
      dispose?.();
    };
  }, []);

  const notas = useUpdaterStore((s) => s.oferta?.notas ?? null);
  const notasHtml = useMemo(() => (notas ? renderMarkdown(notas) : null), [notas]);

  const visible =
    oferta !== null &&
    (fase === "ofreciendo" ||
      fase === "descargando" ||
      fase === "descargado" ||
      fase === "instalando" ||
      fase === "error");

  if (!visible || !oferta) return null;

  const ocupado = fase === "descargando" || fase === "instalando";
  const fecha = fechaLegible(oferta.fecha);
  const pct =
    progreso && progreso.total
      ? Math.min(100, Math.round((progreso.descargado / progreso.total) * 100))
      : null;

  return (
    <div className={styles.overlay}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={esBajada ? "Instalar otra versión" : "Hay una versión nueva"}
      >
        <header className={styles.header}>
          <ArrowDownToLine size={18} className={styles.icon} aria-hidden />
          <span className={styles.title}>
            {esBajada ? "Instalar una versión anterior" : "Hay una versión nueva"}
          </span>
        </header>

        <p className={styles.versions}>
          Mycelium <strong>{oferta.version}</strong> · tenés la {oferta.versionActual}
          {fecha && ` · publicada el ${fecha}`}
        </p>

        <div className={`mic-preview ${styles.notes}`}>
          {notasHtml ? (
            <div dangerouslySetInnerHTML={{ __html: notasHtml }} />
          ) : (
            <p className={styles.sinNotas}>
              Esta versión se publicó sin notas.
            </p>
          )}
        </div>

        {esBajada && (
          <p className={styles.warn}>
            <TriangleAlert size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> Vas a
            instalar una versión <strong>anterior</strong> a la que tenés.{" "}
            <strong>Tus notas no corren riesgo</strong> —son archivos de texto en disco—,
            pero una versión vieja se encuentra un estado guardado más nuevo y lo descarta:
            vas a perder <strong>las pestañas abiertas</strong> y parte de las preferencias.
            El contenido que use funciones nuevas también se verá peor.
          </p>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}

        {(fase === "descargando" || fase === "instalando") && (
          <div className={styles.progressWrap}>
            <div className={styles.progressLabel}>
              <span>{fase === "instalando" ? "Instalando…" : "Descargando…"}</span>
              {progreso && (
                <span>
                  {pct !== null
                    ? `${pct}% · ${mb(progreso.descargado)} de ${mb(progreso.total ?? 0)}`
                    : mb(progreso.descargado)}
                </span>
              )}
            </div>
            <div className={styles.progressTrack}>
              <div
                className={`${styles.progressBar} ${pct === null ? styles.progressBarIndet : ""}`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
          </div>
        )}

        <footer className={styles.footer}>
          {!esBajada && (
            <button
              type="button"
              className={styles.skip}
              disabled={ocupado}
              onClick={() => void useUpdaterStore.getState().omitir()}
            >
              Omitir esta versión
            </button>
          )}
          <button
            type="button"
            className={styles.secondaryBtn}
            style={esBajada ? { marginLeft: "auto" } : undefined}
            disabled={fase === "instalando"}
            onClick={() => void useUpdaterStore.getState().masTarde()}
          >
            {fase === "descargado" ? "Ahora no" : "Más tarde"}
          </button>
          {fase === "descargado" ? (
            // La instalación cierra la app: solo ocurre cuando la descarga
            // terminó y el usuario lo confirma explícitamente.
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void useUpdaterStore.getState().instalar()}
            >
              Instalar y reiniciar
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={ocupado}
              onClick={() => void useUpdaterStore.getState().descargar()}
            >
              {fase === "descargando"
                ? "Descargando…"
                : fase === "error"
                  ? "Reintentar"
                  : esBajada
                    ? "Descargar e instalar"
                    : "Actualizar"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
