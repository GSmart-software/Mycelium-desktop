"use client";

import { Inbox, Plus, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  destinoDisponible,
  destinoInicial,
  esCapturaDeTarea,
  interpretarCaptura,
  otroDestino,
  recordarDestino,
  type Captura,
  type DestinoCaptura,
} from "@/lib/bandeja";
import { mensajeDeError } from "@/lib/mensajeError";
import styles from "../workspace/CapturaRapida.module.css";

type Props = {
  /** El nombre del vault destino; `null` si no hay ninguno (solo la personal). */
  nombreVault: string | null;
  /** Anota; si rechaza, el error se muestra y lo escrito se queda. */
  anotar: (captura: Captura, destino: DestinoCaptura) => Promise<void>;
  /** Esc. */
  cerrar: () => void;
  /** En la ventana flotante (`FUN-L-33`, Parte C): ocupa la ventana entera. */
  flotante?: boolean;
};

/**
 * La cajita de la captura rápida (`FUN-L-33`): el campo, la etiqueta
 * nota/tarea, el error y el pie con el destino. La comparten la captura de
 * adentro de la app (`components/workspace/CapturaRapida.tsx`) y la ventana
 * flotante de la captura global (`components/captura/CapturaFlotante.tsx`).
 *
 * No depende de ningún store del workspace a propósito: la ventana flotante no
 * tiene vault, y cargarlos ahí sería pagar el workspace entero por una línea.
 */
export function CajaCaptura({ nombreVault, anotar: anotarEn, cerrar, flotante = false }: Props) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [anotando, setAnotando] = useState(false);
  const [elegido, setElegido] = useState<DestinoCaptura>(() =>
    destinoInicial(typeof window === "undefined" ? null : window.localStorage),
  );
  const hayVault = nombreVault !== null;
  // Sin ninguna ventana con vault solo queda la personal; lo recordado no se toca.
  const destino = destinoDisponible(elegido, hayVault);
  const campoRef = useRef<HTMLInputElement>(null);
  const idAyuda = useId();
  const tarea = esCapturaDeTarea(texto);

  // Al cerrarse, el foco vuelve adonde estaba (el editor, la consola…): la
  // captura no tiene que sacar al usuario de lo que hacía. En la flotante, la
  // ventana se vuelve a mostrar con el foco: el campo lo toma cada vez.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    campoRef.current?.focus();
    const alEnfocar = () => campoRef.current?.focus();
    if (flotante) window.addEventListener("focus", alEnfocar);
    return () => {
      if (flotante) window.removeEventListener("focus", alEnfocar);
      if (previo && previo.isConnected && previo !== document.body) previo.focus();
    };
  }, [flotante]);

  /** Elige el destino y lo recuerda; el foco sigue en el campo. */
  const elegirDestino = (d: DestinoCaptura) => {
    if (d === "vault" && !hayVault) return;
    setElegido(d);
    recordarDestino(window.localStorage, d);
    setError(null);
    campoRef.current?.focus();
  };

  const anotar = async () => {
    if (anotando) return;
    const captura = interpretarCaptura(texto);
    if (captura === null) return;
    setAnotando(true);
    setError(null);
    try {
      await anotarEn(captura, destino);
    } catch (e) {
      // Lo escrito se queda en la cajita: un fallo no se lleva la nota.
      setError(`No se pudo anotar: ${mensajeDeError(e)}`);
      setAnotando(false);
      // `disabled` le quitó el foco al campo: se lo devuelve ya habilitado.
      requestAnimationFrame(() => campoRef.current?.focus());
    }
  };

  return (
    <form
      className={`${styles.captura} ${flotante ? styles.flotante : ""} mic-captura`}
      data-flotante={flotante ? "" : undefined}
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
          aria-label={`Qué anotar (en la Bandeja ${destino === "personal" ? "personal" : "del vault"})`}
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
            } else if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
              // Tab (y Mayús+Tab) cambia el destino sin salir de la cajita:
              // hay solo dos, así que las dos direcciones alternan.
              e.preventDefault();
              e.stopPropagation();
              elegirDestino(otroDestino(destino));
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
        <span>
          <kbd>Tab</kbd> destino
        </span>
        {/* El destino: dos botones con el elegido marcado. Fuera del orden de
            Tab (`tabIndex={-1}`): Tab en el campo ya alterna, y salir de la
            cajita con Tab la dejaría abierta sin foco. */}
        <span
          className={`${styles.destinos} mic-captura-destinos`}
          role="group"
          aria-label="Destino de la captura"
        >
          <button
            type="button"
            tabIndex={-1}
            className={`${styles.destino} mic-captura-destino`}
            data-destino="vault"
            aria-pressed={destino === "vault"}
            disabled={!hayVault}
            title={
              hayVault
                ? "Se anota al final de la Bandeja de este vault"
                : "No hay ningún vault abierto: abre uno en Mycelium para anotar en su Bandeja"
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => elegirDestino("vault")}
          >
            <Inbox size={14} aria-hidden />
            {hayVault ? `Vault · ${nombreVault}` : "Sin vault abierto"}
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={`${styles.destino} mic-captura-destino`}
            data-destino="personal"
            aria-pressed={destino === "personal"}
            title="Se anota en tu Bandeja personal: la misma desde todos los vaults, fuera de ellos"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => elegirDestino("personal")}
          >
            <UserRound size={14} aria-hidden />
            Personal
          </button>
        </span>
      </div>
    </form>
  );
}
