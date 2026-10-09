"use client";

import { useEffect } from "react";
import { ATMOSFERAS, type Atmosfera } from "@/lib/atmosferas";
import { admiteAtmosfera, temasVisibles } from "@/lib/temas";
import { type Tema, usePreferencesStore } from "@/stores/preferencesStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { Interruptor } from "./Interruptor";
import styles from "./Settings.module.css";

/**
 * Sección Apariencia: tema, modo oscuro (HU-12) y la atmósfera de cada modo
 * (lib/atmosferas.ts). Las dos atmósferas se eligen siempre, esté el modo que
 * esté: la del otro modo rige cuando se cambie.
 *
 * Las muestras de tema salen de `lib/temas.ts`. Las marcadas `soloDev` (el tema
 * Arrecife, `FUN-M-51`, y el tema GSmart, `FUN-M-52`) solo existen con el modo desarrollador y llevan la
 * marca «dev», como los comandos de desarrollador de la paleta. Sin el modo, un
 * vault que ya está en ese tema se sigue pintando así, pero su muestra no
 * aparece y ninguna figura elegida (decisión del usuario, 2026-10-08).
 */
export function AppearanceSection() {
  const tema = usePreferencesStore((s) => s.tema);
  const modoOscuro = usePreferencesStore((s) => s.modoOscuro);
  const setTema = usePreferencesStore((s) => s.setTema);
  const toggleDark = usePreferencesStore((s) => s.toggleDark);
  const atmosferaOscuro = usePreferencesStore((s) => s.prefs.atmosferaOscuro);
  const atmosferaClaro = usePreferencesStore((s) => s.prefs.atmosferaClaro);
  const setPref = usePreferencesStore((s) => s.setPref);
  const dev = useUpdaterStore((s) => s.estado?.dev ?? false);

  // El estado del actualizador (de donde sale `dev`) se carga a demanda: si
  // Configuración se abre antes que la paleta o la sección Actualizaciones,
  // todavía no está.
  useEffect(() => {
    const updater = useUpdaterStore.getState();
    if (!updater.estado) void updater.cargarEstado();
  }, []);

  const conAtmosfera = admiteAtmosfera(tema);

  return (
    <div>
      <div className={styles.field}>
        <span className={styles.label}>Tema</span>
        <div className={styles.swatchGroup}>
          {temasVisibles(dev).map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.swatch} ${tema === t.id ? styles.swatchActive : ""}`}
              aria-pressed={tema === t.id}
              onClick={() => setTema(t.id)}
            >
              <span className={styles.swatchPreview} style={{ background: t.canvas }}>
                <span className={styles.swatchDot} style={{ background: t.glow }} />
                <span className={styles.swatchDot} style={{ background: t.accent }} />
                <span className={styles.swatchDot} style={{ background: t.mist }} />
              </span>
              <span className={styles.swatchName}>
                {t.soloDev && <span className={styles.etiquetaDev}>dev</span>}
                {t.nombre}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Interruptor
        etiqueta="Modo oscuro"
        valor={modoOscuro}
        onChange={toggleDark}
        className={styles.filaModo}
      />

      <SelectorAtmosfera
        titulo="Atmósfera en modo oscuro"
        tema={tema}
        oscuro
        valor={atmosferaOscuro}
        habilitado={conAtmosfera}
        onElegir={(a) => setPref("atmosferaOscuro", a)}
      />
      <SelectorAtmosfera
        titulo="Atmósfera en modo claro"
        tema={tema}
        oscuro={false}
        valor={atmosferaClaro}
        habilitado={conAtmosfera}
        onElegir={(a) => setPref("atmosferaClaro", a)}
      />
      {/* Un aviso para los dos selectores, debajo del segundo: dice por qué no
          responden sin nombrar el tema (lo del modo dev no se anuncia). */}
      {!conAtmosfera && (
        <p className={styles.hint} id="aviso-atmosfera">
          Este tema trae sus propios fondos: las atmósferas no se le aplican. La que elegiste vuelve
          al cambiar de tema.
        </p>
      )}
    </div>
  );
}

/**
 * Las cuatro atmósferas de un modo. Cada muestra repite `data-theme`,
 * `data-dark` y `data-atmosfera` en su propio <span>: las reglas de tokens.css
 * y atmosferas.css la pintan como se vería ESA combinación, aunque la app esté
 * en el otro modo.
 *
 * Con un tema que no admite atmósferas (`habilitado` en falso) el selector se
 * sigue viendo —para que se note que existe y que no aplica— pero atenuado y sin
 * responder. La atmósfera guardada se sigue marcando: es la que vuelve.
 */
function SelectorAtmosfera({
  titulo,
  tema,
  oscuro,
  valor,
  habilitado,
  onElegir,
}: {
  titulo: string;
  tema: Tema;
  oscuro: boolean;
  valor: Atmosfera;
  habilitado: boolean;
  onElegir: (a: Atmosfera) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={`${styles.label} ${habilitado ? "" : styles.labelDeshabilitado}`}>{titulo}</span>
      <div
        className={styles.atmosferas}
        role="group"
        aria-label={titulo}
        aria-describedby={habilitado ? undefined : "aviso-atmosfera"}
      >
        {ATMOSFERAS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`${styles.swatch} ${valor === a.id ? styles.swatchActive : ""} ${
              habilitado ? "" : styles.swatchDeshabilitada
            }`}
            aria-pressed={valor === a.id}
            title={a.descripcion}
            disabled={!habilitado}
            onClick={() => onElegir(a.id)}
          >
            <span
              className={styles.muestra}
              data-theme={tema}
              data-dark={oscuro ? "true" : undefined}
              data-atmosfera={a.id}
              aria-hidden
            >
              <span className={styles.muestraMarco} />
              <span className={styles.muestraPanel} />
              <span className={styles.muestraLienzo}>
                <span className={styles.muestraTitulo} />
                <span className={styles.muestraTexto} />
                <span className={styles.muestraEnlace} />
              </span>
            </span>
            <span className={styles.swatchName}>{a.nombre}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
