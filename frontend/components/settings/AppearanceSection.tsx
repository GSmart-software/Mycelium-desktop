"use client";

import { ATMOSFERAS, type Atmosfera } from "@/lib/atmosferas";
import { type Tema, usePreferencesStore } from "@/stores/preferencesStore";
import { Interruptor } from "./Interruptor";
import styles from "./Settings.module.css";

// Swatches con la paleta del modo oscuro (predeterminado) de cada tema.
const TEMAS: { value: Tema; nombre: string; canvas: string; mist: string; glow: string; accent: string }[] = [
  { value: "bioluminiscencia", nombre: "Bioluminiscencia", canvas: "#071219", mist: "#0a1a24", glow: "#3DFFC4", accent: "#19E6FF" },
  { value: "cantarela", nombre: "Cantarela", canvas: "#1b1305", mist: "#241a08", glow: "#FFC247", accent: "#C77F2E" },
];

/**
 * Sección Apariencia: tema, modo oscuro (HU-12) y la atmósfera de cada modo
 * (lib/atmosferas.ts). Las dos atmósferas se eligen siempre, esté el modo que
 * esté: la del otro modo rige cuando se cambie.
 */
export function AppearanceSection() {
  const tema = usePreferencesStore((s) => s.tema);
  const modoOscuro = usePreferencesStore((s) => s.modoOscuro);
  const setTema = usePreferencesStore((s) => s.setTema);
  const toggleDark = usePreferencesStore((s) => s.toggleDark);
  const atmosferaOscuro = usePreferencesStore((s) => s.prefs.atmosferaOscuro);
  const atmosferaClaro = usePreferencesStore((s) => s.prefs.atmosferaClaro);
  const setPref = usePreferencesStore((s) => s.setPref);

  return (
    <div>
      <div className={styles.field}>
        <span className={styles.label}>Tema</span>
        <div className={styles.swatchGroup}>
          {TEMAS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`${styles.swatch} ${tema === t.value ? styles.swatchActive : ""}`}
              aria-pressed={tema === t.value}
              onClick={() => setTema(t.value)}
            >
              <span className={styles.swatchPreview} style={{ background: t.canvas }}>
                <span className={styles.swatchDot} style={{ background: t.glow }} />
                <span className={styles.swatchDot} style={{ background: t.accent }} />
                <span className={styles.swatchDot} style={{ background: t.mist }} />
              </span>
              <span className={styles.swatchName}>{t.nombre}</span>
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
        onElegir={(a) => setPref("atmosferaOscuro", a)}
      />
      <SelectorAtmosfera
        titulo="Atmósfera en modo claro"
        tema={tema}
        oscuro={false}
        valor={atmosferaClaro}
        onElegir={(a) => setPref("atmosferaClaro", a)}
      />
    </div>
  );
}

/**
 * Las cuatro atmósferas de un modo. Cada muestra repite `data-theme`,
 * `data-dark` y `data-atmosfera` en su propio <span>: las reglas de tokens.css
 * y atmosferas.css la pintan como se vería ESA combinación, aunque la app esté
 * en el otro modo.
 */
function SelectorAtmosfera({
  titulo,
  tema,
  oscuro,
  valor,
  onElegir,
}: {
  titulo: string;
  tema: Tema;
  oscuro: boolean;
  valor: Atmosfera;
  onElegir: (a: Atmosfera) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{titulo}</span>
      <div className={styles.atmosferas} role="group" aria-label={titulo}>
        {ATMOSFERAS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`${styles.swatch} ${valor === a.id ? styles.swatchActive : ""}`}
            aria-pressed={valor === a.id}
            title={a.descripcion}
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
