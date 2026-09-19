"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { useCallback, useRef, useState, type ComponentType } from "react";
import { useMenuEmergente } from "@/lib/useMenuEmergente";
import styles from "./ExplorerPanel.module.css";

export type ItemNuevo = {
  label: string;
  icono: LucideIcon | ComponentType<{ size?: number }>;
  onClick: () => void;
};

/**
 * «Nuevo ▾» del explorador (rediseño del cascarón, 2026-09-19): dibujo, base,
 * lienzo, carpeta e importar, detrás de un botón con rótulo. Antes eran cinco
 * íconos sueltos al lado de «Nueva nota», la misma fila de íconos sin nombre
 * que el rediseño sacó de la barra del editor. «Nueva nota», lo que más se usa,
 * queda afuera como ícono.
 */
export function MenuNuevo({ items }: { items: ItemNuevo[] }) {
  const [abierto, setAbierto] = useState(false);
  // Fijo a la ventana y no absoluto: el panel lateral recorta lo que se sale.
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const contenedorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const cerrar = useCallback(() => setAbierto(false), []);
  useMenuEmergente({ abierto, cerrar, contenedorRef, menuRef, disparadorRef });

  return (
    <div className={styles.menuNuevoWrap} ref={contenedorRef}>
      <button
        ref={disparadorRef}
        type="button"
        className={styles.menuNuevoBoton}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => {
          const r = disparadorRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 4, left: r.left });
          setAbierto((a) => !a);
        }}
      >
        Nuevo
        <ChevronDown size={14} aria-hidden />
      </button>
      {abierto && (
        <div
          ref={menuRef}
          className={styles.menuNuevo}
          role="menu"
          aria-label="Nuevo"
          style={{ top: pos.top, left: pos.left }}
        >
          {items.map(({ label, icono: Icono, onClick }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className={styles.menuNuevoItem}
              onClick={() => {
                cerrar();
                onClick();
              }}
            >
              <Icono size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
