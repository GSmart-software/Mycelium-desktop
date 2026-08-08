"use client";

import { useEffect, useState } from "react";
import {
  compararVersiones,
  fechaLegible,
  listarVersiones,
  type VersionPublicada,
} from "@/lib/updater";
import { useUpdaterStore } from "@/stores/updaterStore";
import styles from "./Settings.module.css";
import { confirmar } from "@/lib/confirmar";

/** Texto de un error de `invoke` (Rust devuelve strings). */
const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Sección de actualizaciones de Configuración (`FUN-L-14` + `FUN-M-16`).
 *
 * Tres bloques que se muestran según el estado:
 *
 * 1. **Siempre**: buscar actualizaciones a mano (informa también cuando NO hay
 *    nada nuevo) e interruptor de la comprobación automática.
 * 2. **Si el updater no está configurado**: el motivo, en vez de botones que no
 *    harían nada. Es el estado en el que está hasta que existan las claves.
 * 3. **Solo en modo avanzado** (siete clics en el número de versión del pie):
 *    el endpoint propio y la lista de versiones publicadas.
 */
export function UpdaterSection() {
  const estado = useUpdaterStore((s) => s.estado);
  const fase = useUpdaterStore((s) => s.fase);
  const aviso = useUpdaterStore((s) => s.aviso);

  const [versiones, setVersiones] = useState<VersionPublicada[] | null>(null);
  const [cargandoVersiones, setCargandoVersiones] = useState(false);
  const [errorVersiones, setErrorVersiones] = useState<string | null>(null);
  const [endpointBorrador, setEndpointBorrador] = useState("");
  const [errorEndpoint, setErrorEndpoint] = useState<string | null>(null);

  useEffect(() => {
    void useUpdaterStore.getState().cargarEstado();
  }, []);

  // El borrador del endpoint sigue al estado real mientras no se esté editando.
  const endpointReal = estado?.endpointPersonalizado ? estado.endpoint : "";
  const [endpointVisto, setEndpointVisto] = useState(endpointReal);
  if (endpointVisto !== endpointReal) {
    setEndpointVisto(endpointReal);
    setEndpointBorrador(endpointReal);
    setErrorEndpoint(null);
  }

  const cargarVersiones = async () => {
    setCargandoVersiones(true);
    setErrorVersiones(null);
    try {
      setVersiones(await listarVersiones());
    } catch (e) {
      setErrorVersiones(texto(e));
      setVersiones(null);
    } finally {
      setCargandoVersiones(false);
    }
  };

  const guardarEndpoint = async () => {
    const valor = endpointBorrador.trim();
    if (valor === endpointReal) return;
    setErrorEndpoint(null);
    try {
      await useUpdaterStore.getState().guardarEndpoint(valor === "" ? null : valor);
      setVersiones(null); // el índice de versiones era del bucket anterior
    } catch (e) {
      setErrorEndpoint(texto(e));
    }
  };

  const elegir = async (v: VersionPublicada) => {
    const actual = estado?.versionActual ?? "";
    const anterior = compararVersiones(v.version, actual) < 0;
    const texto1 = anterior
      ? `Vas a instalar la ${v.version}, ANTERIOR a la ${actual} que tenés.\n\n` +
        "Tus notas no corren riesgo (son archivos de texto en disco), pero una versión " +
        "vieja descarta el estado guardado más nuevo: vas a perder las pestañas abiertas " +
        "y parte de las preferencias.\n\n¿Seguir?"
      : `Vas a instalar la ${v.version} en lugar de la ${actual}.\n\n¿Seguir?`;
    if (!(await confirmar(texto1))) return;
    useUpdaterStore.getState().ofrecerVersion(v.version, v.manifiesto, v.notas);
  };

  if (!estado) {
    return (
      <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
        Cargando el estado de las actualizaciones…
      </p>
    );
  }

  const buscando = fase === "buscando";

  return (
    <div>
      {/* Estado del updater: si no está configurado, se dice por qué. */}
      {!estado.habilitado && (
        <div className={styles.field}>
          <span className={styles.label}>Actualizaciones desactivadas</span>
          <p className={styles.warn}>{estado.motivo}</p>
        </div>
      )}

      {/* Versión fijada a mano (FUN-M-16): indicador + forma de volver. */}
      {estado.versionFijada && (
        <div className={styles.field}>
          <span className={styles.label}>Versión fijada</span>
          <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
            Elegiste instalar la <strong>{estado.versionFijada}</strong> a mano, así que
            Mycelium <strong>dejó de ofrecerte actualizaciones</strong>. Volvé a seguirlas
            cuando termines de investigar lo que fueras a investigar.
          </p>
          <div className={styles.btnRow}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void useUpdaterStore.getState().soltarFijacion()}
            >
              Seguir las actualizaciones otra vez
            </button>
          </div>
        </div>
      )}

      <div className={styles.field}>
        <div className={styles.toggleRow}>
          <span className={styles.label}>Buscar actualizaciones automáticamente</span>
          <label
            className={styles.switch}
            title={estado.auto ? "Activado" : "Desactivado"}
          >
            <input
              type="checkbox"
              checked={estado.auto}
              onChange={(e) => void useUpdaterStore.getState().setAuto(e.target.checked)}
              aria-label="Comprobar actualizaciones automáticamente al arrancar"
            />
            <span className={styles.switchTrack} aria-hidden />
          </label>
        </div>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Una vez al día, en el primer arranque de la jornada, y en segundo plano: la app
          abre igual aunque no haya conexión y nunca se actualiza sola. Desactivalo y
          Mycelium no hará <strong>ninguna</strong> petición de red al arrancar; el botón de
          acá abajo sigue funcionando.
          {estado.ultimaComprobacion && (
            <> Última comprobación: <strong>{estado.ultimaComprobacion}</strong>.</>
          )}
          {estado.versionOmitida && (
            <> Versión omitida: <strong>{estado.versionOmitida}</strong> (se volverá a
            avisar cuando salga otra).</>
          )}
        </p>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={buscando}
            onClick={() => void useUpdaterStore.getState().comprobarManual()}
          >
            {buscando ? "Buscando…" : "Buscar actualizaciones"}
          </button>
        </div>
        {aviso && (
          <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-primary)" }}>
            {aviso}
          </p>
        )}
      </div>

      {/* ── Modo avanzado (FUN-M-16) ──────────────────────────────────── */}
      {estado.avanzado && (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="mic-updater-endpoint">
              Servidor de actualizaciones
            </label>
            <input
              id="mic-updater-endpoint"
              className={styles.input}
              value={endpointBorrador}
              spellCheck={false}
              placeholder={estado.endpointDefecto}
              onChange={(e) => setEndpointBorrador(e.target.value)}
              onBlur={() => void guardarEndpoint()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setEndpointBorrador(endpointReal);
                  setErrorEndpoint(null);
                }
              }}
            />
            <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
              URL del <code>latest.json</code>. Vacío = el compilado en esta versión
              (<code>{estado.endpointDefecto}</code>). Sirve para probar contra un bucket de
              pruebas sin tocar el de producción, y para el día que haya que cambiar la URL
              sin reinstalar nada.
            </p>
            {errorEndpoint && (
              <p className={styles.warn} role="alert">
                {errorEndpoint}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Versiones publicadas</span>
            <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
              Herramienta de desarrollo: instalar cualquier versión publicada, incluida una
              anterior a la actual —para revisar cómo se comportaba algo, o para volver
              atrás si una versión sale mal—. Elegir una <strong>fija</strong> la app en
              ella y apaga el aviso diario hasta que lo deshagas.
            </p>
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={cargandoVersiones || !estado.habilitado}
                onClick={() => void cargarVersiones()}
              >
                {cargandoVersiones ? "Cargando…" : "Cargar lista de versiones"}
              </button>
            </div>
            {errorVersiones && (
              <p className={styles.warn} role="alert">
                No se pudo leer el índice de versiones: {errorVersiones}
              </p>
            )}
            {versiones !== null && versiones.length === 0 && (
              <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
                El índice está vacío: no hay ninguna versión publicada.
              </p>
            )}
            {versiones !== null && versiones.length > 0 && (
              <ul className={styles.snippetList}>
                {versiones.map((v) => {
                  const instalada = v.version === estado.versionActual;
                  return (
                    <li key={v.version} className={styles.snippetRow}>
                      <span className={styles.snippetName}>
                        {v.version}
                        {instalada && " · instalada"}
                        {v.fecha && ` · ${fechaLegible(v.fecha)}`}
                      </span>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={instalada}
                        onClick={() => elegir(v)}
                      >
                        {instalada ? "En uso" : "Instalar"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
