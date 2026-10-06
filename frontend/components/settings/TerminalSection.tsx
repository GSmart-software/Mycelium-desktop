"use client";

import { useEffect, useState } from "react";
import { listarShells, type ShellInfo } from "@/lib/terminalBase";
import { useTerminalStore } from "@/stores/terminalStore";
import { Interruptor } from "./Interruptor";
import { Explicacion } from "./Explicacion";
import styles from "./Settings.module.css";

/** Sección Terminal (FUN-L-07 CA5/CA6): shell por defecto y restauración. */
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
      </div>
      <Explicacion detalle="Para una consola puntual, en el panel de Consolas hacé clic derecho en «Nueva terminal» y elegí otra shell.">
        La shell que se inicia al crear una consola nueva.
      </Explicacion>

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
    </div>
  );
}
