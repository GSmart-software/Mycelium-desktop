"use client";

import { Inbox, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { esCapturaDeTarea, interpretarCaptura, textoAvisoCaptura } from "@/lib/bandeja";
import { anotarEnBandeja } from "@/lib/bandejaVault";
import { mensajeDeError } from "@/lib/mensajeError";
import { nombreDeVault } from "@/lib/vaultMode";
import { avisar } from "@/stores/avisosStore";
import { grabandoAtajo } from "@/lib/comandos/grabacion";
import { useUiStore } from "@/stores/uiStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import styles from "./CapturaRapida.module.css";

/**
 * ¿Esta tecla es el atajo de la captura rápida (Ctrl+Shift+Espacio)? Por
 * `code` y no por `key`: con Mayús, algunos teclados no dan `" "`. Cmd en
 * macOS, como el resto de los atajos de la app.
 */
export function esAtajoCaptura(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === "Space" || e.key === " ");
}

/**
 * La captura rápida (`FUN-L-33`): una cajita que flota arriba, sobre lo que
 * esté abierto, para anotar algo sin decidir dónde va. Enter lo agrega al
 * final de la Bandeja del vault, con la hora y bajo el encabezado del día; Esc
 * o un clic afuera cierra sin anotar. No abre la Bandeja ni cambia la pestaña
 * activa: al cerrarse, el foco vuelve adonde estaba.
 *
 * El pie tiene el **destino**. Hoy hay uno solo, la Bandeja del vault; la
 * Parte B de `FUN-L-33` suma la Bandeja personal, y el pie pasa a ser un
 * selector (Tab o clic) que recuerda el último elegido.
 */
export function CapturaRapida() {
  const abierta = useUiStore((s) => s.capturaAbierta);
  // El atajo se escucha siempre, en captura: así llega antes que CodeMirror,
  // la consola o un lienzo, que podrían quedarse con la tecla.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!esAtajoCaptura(e) || grabandoAtajo()) return;
      e.preventDefault();
      e.stopPropagation();
      const ui = useUiStore.getState();
      ui.setCaptura(!ui.capturaAbierta);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
  return abierta ? <Cajita /> : null;
}

function Cajita() {
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [anotando, setAnotando] = useState(false);
  const campoRef = useRef<HTMLInputElement>(null);
  const idAyuda = useId();
  const tarea = esCapturaDeTarea(texto);

  // Al cerrarse, el foco vuelve adonde estaba (el editor, la consola…): la
  // captura no tiene que sacar al usuario de lo que hacía.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    campoRef.current?.focus();
    return () => {
      if (previo && previo.isConnected && previo !== document.body) previo.focus();
    };
  }, []);

  const cerrar = () => useUiStore.getState().setCaptura(false);

  const anotar = async () => {
    if (anotando) return;
    const captura = interpretarCaptura(texto);
    if (captura === null) return;
    setAnotando(true);
    setError(null);
    try {
      await anotarEnBandeja(captura);
      cerrar();
      avisar(textoAvisoCaptura(captura));
    } catch (e) {
      // Lo escrito se queda en la cajita: un fallo no se lleva la nota.
      setError(`No se pudo anotar: ${mensajeDeError(e)}`);
      setAnotando(false);
      campoRef.current?.focus();
    }
  };

  return (
    <div
      className={`${styles.velo} mic-captura-velo`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <form
        className={`${styles.captura} mic-captura`}
        role="dialog"
        aria-label="Captura rápida"
        onSubmit={(e) => {
          e.preventDefault();
          void anotar();
        }}
      >
        <div className={styles.fila}>
          <Plus size={18} className={styles.icono} aria-hidden />
          <input
            ref={campoRef}
            className={styles.campo}
            value={texto}
            disabled={anotando}
            autoComplete="off"
            spellCheck
            placeholder="Anotar algo… ([] al principio para una tarea)"
            aria-label="Qué anotar"
            aria-describedby={idAyuda}
            onChange={(e) => {
              setTexto(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Que no lo vea nadie más: cerraría también otra cosa.
                e.preventDefault();
                e.stopPropagation();
                cerrar();
              } else if (e.key === "Enter" && e.nativeEvent.isComposing) {
                e.preventDefault();
              }
            }}
          />
          <span className={`${styles.tipo} mic-captura-tipo`} data-tipo={tarea ? "tarea" : "nota"}>
            {tarea ? "tarea" : "nota"}
          </span>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.pie} id={idAyuda}>
          <span>
            <kbd>Enter</kbd> anotar
          </span>
          <span>
            <kbd>Esc</kbd> cerrar
          </span>
          {/* El destino. Con la Bandeja personal (Parte B) pasa a ser un
              grupo de botones (Tab o clic) con el elegido marcado. */}
          <span className={`${styles.destino} mic-captura-destino`} title="Se anota al final de la Bandeja de este vault">
            <Inbox size={14} aria-hidden />
            Vault · {rutaVault ? nombreDeVault(rutaVault) : ""}
          </span>
        </div>
      </form>
    </div>
  );
}
