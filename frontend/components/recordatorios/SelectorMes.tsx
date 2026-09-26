"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { nombreDelMes } from "@/lib/recordatorios";
import styles from "./Recordatorios.module.css";

/**
 * El título del mes, que además sirve para saltar lejos (`FUN-L-22`).
 *
 * Con solo «mes anterior / siguiente», ir cinco años atrás eran sesenta clics:
 * lo notó el usuario al probar el calendario (2026-09-25). El título abre un
 * selector con el **año** —de a uno o de a diez, o escribiéndolo— y los **doce
 * meses**; elegir un mes lleva ahí y cierra. Lo usan la pestaña y el panel.
 */
export function SelectorMes({
  anio,
  mes,
  onElegir,
  compacto = false,
}: {
  anio: number;
  mes: number;
  onElegir: (anio: number, mes: number) => void;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  // El año que se está mirando en el selector: puede ser otro que el visible
  // hasta que se elige un mes.
  const [anioSel, setAnioSel] = useState(anio);
  const [textoAnio, setTextoAnio] = useState(String(anio));
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  const abrir = () => {
    setAnioSel(anio);
    setTextoAnio(String(anio));
    setAbierto(true);
  };

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  };

  const ponerAnio = (a: number) => {
    const acotado = Math.min(9999, Math.max(1, a));
    setAnioSel(acotado);
    setTextoAnio(String(acotado));
  };

  // Afuera o Escape cierran. Se escucha en `mousedown` para que el clic que
  // cierra no llegue además a lo que haya debajo.
  useEffect(() => {
    if (!abierto) return;
    campo.current?.select();
    const fuera = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) cerrar(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar(true);
      }
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla, true);
    };
  }, [abierto]);

  const hoy = new Date();

  return (
    <div className={styles.selector} ref={raiz}>
      <button
        ref={boton}
        type="button"
        className={compacto ? styles.selectorBotonCompacto : styles.selectorBoton}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        title="Elegir mes y año"
        onClick={() => (abierto ? cerrar(false) : abrir())}
      >
        <span aria-live="polite">
          {nombreDelMes(mes)} {anio}
        </span>
      </button>

      {abierto && (
        <div className={styles.selectorPanel} role="dialog" aria-label="Elegir mes y año">
          <div className={styles.selectorAnio}>
            <button
              type="button"
              className={styles.botonIcono}
              aria-label="Diez años antes"
              title="Diez años antes"
              onClick={() => ponerAnio(anioSel - 10)}
            >
              <ChevronsLeft size={16} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.botonIcono}
              aria-label="Año anterior"
              title="Año anterior"
              onClick={() => ponerAnio(anioSel - 1)}
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <input
              ref={campo}
              className={styles.selectorCampoAnio}
              inputMode="numeric"
              aria-label="Año"
              value={textoAnio}
              onChange={(e) => {
                const t = e.target.value.replace(/\D/g, "").slice(0, 4);
                setTextoAnio(t);
                // Se aplica a medida que se escribe, pero solo con un año
                // completo: con «20» a mitad de escribir «2021» no salta al año 20.
                if (t.length === 4) setAnioSel(Number(t));
              }}
              onBlur={() => setTextoAnio(String(anioSel))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const n = Number(textoAnio);
                  if (n >= 1) ponerAnio(n);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  ponerAnio(anioSel + 1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  ponerAnio(anioSel - 1);
                }
              }}
            />
            <button
              type="button"
              className={styles.botonIcono}
              aria-label="Año siguiente"
              title="Año siguiente"
              onClick={() => ponerAnio(anioSel + 1)}
            >
              <ChevronRight size={16} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.botonIcono}
              aria-label="Diez años después"
              title="Diez años después"
              onClick={() => ponerAnio(anioSel + 10)}
            >
              <ChevronsRight size={16} aria-hidden />
            </button>
          </div>

          <div className={styles.selectorMeses}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const visible = anioSel === anio && m === mes;
              const actual = anioSel === hoy.getFullYear() && m === hoy.getMonth() + 1;
              return (
                <button
                  key={m}
                  type="button"
                  className={styles.selectorMes}
                  data-visible={visible || undefined}
                  data-actual={actual || undefined}
                  aria-current={visible ? "date" : undefined}
                  aria-label={`${nombreDelMes(m)} ${anioSel}`}
                  onClick={() => {
                    onElegir(anioSel, m);
                    cerrar(true);
                  }}
                >
                  {nombreDelMes(m).slice(0, 3)}
                </button>
              );
            })}
          </div>

          {/* La vuelta: sin esto, el panel —que no tiene botón «Hoy» propio—
              quedaba varado en el año al que se saltó. */}
          <button
            type="button"
            className={styles.selectorHoy}
            onClick={() => {
              onElegir(hoy.getFullYear(), hoy.getMonth() + 1);
              cerrar(true);
            }}
          >
            Ir a hoy
          </button>
        </div>
      )}
    </div>
  );
}
