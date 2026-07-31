"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { listarShells, type ShellInfo } from "@/lib/terminal";
import { useTerminalStore } from "@/stores/terminalStore";
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
      <p className={styles.hint}>
        La shell que se inicia al crear una consola nueva. En el panel de Consolas
        (botón de terminal del rail), con clic derecho en &quot;Nueva terminal&quot;
        podés elegir otra shell para una consola puntual.
      </p>

      <div className={styles.toggleRow}>
        <span className={styles.label}>Restaurar terminales al abrir</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPref("restaurarSesiones", !prefs.restaurarSesiones)}
          aria-pressed={prefs.restaurarSesiones}
        >
          {prefs.restaurarSesiones ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {prefs.restaurarSesiones ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Al reabrir Mycelium se recrean las terminales que estaban abiertas (misma
        shell y carpeta inicial). El proceso anterior no sobrevive: se inicia una
        shell nueva.
      </p>

      <div className={styles.toggleRow}>
        <span className={styles.label}>Restaurar el historial</span>
        <button
          type="button"
          className={styles.toggle}
          disabled={!prefs.restaurarSesiones}
          onClick={() => setPref("restaurarScrollback", !prefs.restaurarScrollback)}
          aria-pressed={prefs.restaurarScrollback}
        >
          {prefs.restaurarScrollback ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}
          {prefs.restaurarScrollback ? "Activado" : "Desactivado"}
        </button>
      </div>
      <p className={styles.hint}>
        Muestra el texto de la sesión anterior al restaurar una terminal (solo
        lectura, como historial), antes del prompt nuevo.
      </p>
    </div>
  );
}
