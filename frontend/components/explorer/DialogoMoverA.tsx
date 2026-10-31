"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderInput } from "lucide-react";
import { destinosDeMover, type DestinoCarpeta } from "@/lib/menuNota";
import { useDialogoModal } from "@/lib/useDialogoModal";
import type { TreeCarpeta } from "@/stores/vaultStore";
// La misma piel que la paleta de comandos (Ctrl+P), temas incluidos: elegir una
// carpeta es elegir de una lista filtrable, como en Obsidian.
import styles from "../workspace/PaletaComandos.module.css";

/**
 * «Mover a…» del menú del explorador (`FUN-S-32`): un buscador de carpetas del
 * vault. Elegir una llama a `onElegir` con su id (`null` = la raíz); mover lo
 * hace quien abrió el diálogo, con el mismo `moveNota`/`moveCarpeta` que el
 * arrastre, que repara los enlaces entrantes.
 *
 * Teclado: escribir filtra, ↑/↓ recorren, Enter elige, Esc cierra.
 */
export function DialogoMoverA({
  nombre,
  carpetas,
  actual,
  excluir,
  onElegir,
  onCerrar,
}: {
  /** Lo que se mueve, para el texto del campo. */
  nombre: string;
  carpetas: readonly TreeCarpeta[];
  actual: string | null;
  excluir?: ReadonlySet<string>;
  onElegir: (destino: string | null) => void;
  onCerrar: () => void;
}) {
  const dialogoRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const [consulta, setConsulta] = useState("");
  const [activa, setActiva] = useState(0);
  useDialogoModal({ abierto: true, cerrar: onCerrar, dialogoRef });

  const destinos = useMemo(
    () => destinosDeMover(carpetas, { actual, excluir }, consulta),
    [carpetas, actual, excluir, consulta],
  );

  // La opción activa se ve (y al filtrar vuelve a la primera: `onChange`).
  useEffect(() => {
    listaRef.current?.children[activa]?.scrollIntoView({ block: "nearest" });
  }, [activa]);

  function elegir(destino: DestinoCarpeta | undefined) {
    if (!destino) return;
    onElegir(destino.id);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (destinos.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiva((i) => (i + delta + destinos.length) % destinos.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      elegir(destinos[activa]);
    }
  }

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        ref={dialogoRef}
        className={styles.paleta}
        role="dialog"
        aria-modal="true"
        aria-label={`Mover «${nombre}» a una carpeta`}
      >
        <div className={styles.campo}>
          <FolderInput size={16} className={styles.lupa} aria-hidden />
          <input
            className={styles.input}
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setActiva(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={`Mover «${nombre}» a…`}
            aria-label="Buscar carpeta"
            aria-controls="mover-a-lista"
            aria-activedescendant={destinos.length > 0 ? `mover-a-${activa}` : undefined}
            role="combobox"
            aria-expanded="true"
            spellCheck={false}
          />
        </div>
        {destinos.length === 0 ? (
          <p className={styles.vacio}>Ninguna carpeta coincide.</p>
        ) : (
          <ul id="mover-a-lista" ref={listaRef} className={styles.lista} role="listbox">
            {destinos.map((d, i) => (
              <li
                key={d.id ?? "/"}
                id={`mover-a-${i}`}
                role="option"
                aria-selected={i === activa}
                className={`${styles.opcion} ${i === activa ? styles.opcionActiva : ""}`}
                onPointerMove={() => setActiva(i)}
                onClick={() => elegir(d)}
              >
                <Folder size={14} aria-hidden />
                <span className={styles.titulo}>{d.id === null ? "Raíz del vault" : d.ruta}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.pie}>
          <kbd>↑</kbd>
          <kbd>↓</kbd> recorrer · <kbd>Enter</kbd> mover · <kbd>Esc</kbd> cerrar · los enlaces se
          actualizan solos
        </p>
      </div>
    </div>
  );
}
