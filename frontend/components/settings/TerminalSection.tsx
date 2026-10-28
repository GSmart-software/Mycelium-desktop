"use client";

import { useEffect, useState } from "react";
import { listarShells, type ShellInfo } from "@/lib/terminalBase";
import { useTerminalStore, type EfectoConsola } from "@/stores/terminalStore";
import { Interruptor } from "./Interruptor";
import { Explicacion } from "./Explicacion";
import styles from "./Settings.module.css";

/** Las partes de la consola estilada (`FUN-M-57`), cada una con su interruptor. */
const EFECTOS: { clave: EfectoConsola; etiqueta: string; ayuda: string }[] = [
  { clave: "efectoFondo", etiqueta: "Fondo", ayuda: "Una aurora con los colores del tema y una red de micelio detrás del texto." },
  { clave: "efectoPulso", etiqueta: "Pulso del fondo", ayuda: "El fondo se mueve: la aurora se desplaza y el micelio se acerca y se aleja." },
  { clave: "efectoParticulas", etiqueta: "Partículas", ayuda: "Esporas de luz que suben despacio." },
  { clave: "efectoBorde", etiqueta: "Borde animado", ayuda: "Un borde de luz que gira alrededor de la consola." },
  { clave: "efectoMarca", etiqueta: "Marca Mycelium", ayuda: "El rótulo «MYCELIUM // TTY» en la esquina de abajo." },
  { clave: "efectoBrillo", etiqueta: "Brillo del texto", ayuda: "El texto y el cursor brillan con su propio color." },
  { clave: "efectoTubo", etiqueta: "Pantalla de tubo", ayuda: "Líneas de barrido, bordes oscurecidos, grano y un haz de luz que baja." },
  { clave: "efectoColores", etiqueta: "Colores del tema", ayuda: "Los colores de los programas, teñidos con el tema; cursor en barra e interlineado más amplio." },
];

/** Sección Terminal (FUN-L-07 CA5/CA6): shell por defecto, restauración y efectos (`FUN-M-57`). */
export function TerminalSection() {
  const prefs = useTerminalStore((s) => s.prefs);
  const setPref = useTerminalStore((s) => s.setPref);
  const [shells, setShells] = useState<ShellInfo[]>([]);

  useEffect(() => {
    void listarShells().then(setShells);
  }, []);

  return (
    <div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="terminalShell">Shell por defecto</label>
        <select
          id="terminalShell"
          className={styles.select}
          value={prefs.shellPorDefecto ?? ""}
          onChange={(e) => setPref("shellPorDefecto", e.target.value || null)}
        >
          <option value="">Predeterminada del sistema</option>
          {shells.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
        <Explicacion detalle="Para una consola puntual, en el panel de Consolas hacé clic derecho en «Nueva terminal» y elegí otra shell.">
          La shell que se inicia al crear una consola nueva.
        </Explicacion>
      </div>

      <Interruptor
        etiqueta="Restaurar terminales al abrir"
        valor={prefs.restaurarSesiones}
        onChange={(v) => setPref("restaurarSesiones", v)}
        ayuda="Al reabrir Mycelium, vuelven las terminales que estaban abiertas."
        detalle="Con la misma shell y la misma carpeta inicial. El proceso anterior no sobrevive: se inicia una shell nueva."
      />

      <Interruptor
        etiqueta="Restaurar el historial"
        valor={prefs.restaurarScrollback}
        disabled={!prefs.restaurarSesiones}
        onChange={(v) => setPref("restaurarScrollback", v)}
        ayuda="Al restaurar una terminal, muestra lo que tenía antes."
        detalle="El texto de la sesión anterior aparece como historial de solo lectura, antes del prompt nuevo."
      />

      <Interruptor
        etiqueta="Consola estilada"
        valor={prefs.efectos}
        onChange={(v) => setPref("efectos", v)}
        ayuda="Una consola con fondo de luz, partículas, pantalla de tubo y texto que brilla. Cada parte se elige abajo."
        detalle="Toma los colores del tema. Rige en el acto en todas las consolas. Usa más la placa de video: si la PC lo sufre, apagá las partes animadas o todo."
      >
        {EFECTOS.map((e) => (
          <Interruptor
            key={e.clave}
            etiqueta={e.etiqueta}
            valor={prefs[e.clave]}
            disabled={!prefs.efectos || (e.clave === "efectoPulso" && !prefs.efectoFondo)}
            onChange={(v) => setPref(e.clave, v)}
            ayuda={e.ayuda}
          />
        ))}
      </Interruptor>
    </div>
  );
}
