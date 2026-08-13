"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./ContextMenu.module.css";

export type MenuItem = {
  label: string;
  danger?: boolean;
  /** Sin acción posible: se muestra apagado, no se oculta (así se descubre). */
  disabled?: boolean;
  /** Texto del tooltip; en una entrada deshabilitada, el motivo. */
  title?: string;
  /** Entradas anidadas: la fila abre un submenú en vez de ejecutar una acción. */
  submenu?: MenuItem[];
  onClick?: () => void;
};

/** Ancho mínimo del menú (ver `.menu` en el CSS), para decidir de qué lado abrir. */
const ANCHO_MENU = 180;

/** Aire que se le deja al borde de la ventana al reubicar el menú. */
const MARGEN = 8;

/** Menú contextual del explorer (clic derecho en carpetas y notas). */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** Etiqueta del submenú abierto (solo uno a la vez). */
  const [abierto, setAbierto] = useState<string | null>(null);
  /** Posición final, ya ajustada para que quepa en pantalla (`DEF-047`). */
  const [pos, setPos] = useState({ x, y });

  /**
   * Reubica el menú si no entra en la ventana.
   *
   * Se **mide** el menú ya montado en vez de estimar su alto: la altura depende
   * de cuántas entradas tenga cada menú —el de una carpeta y el de una nota no
   * son iguales— y cualquier número fijo se queda corto en cuanto se agrega una
   * opción. `useLayoutEffect` corre antes de pintar, así que no se ve saltar.
   *
   * Primero se intenta volcar hacia el otro lado del cursor, que es lo que
   * espera cualquiera; si tampoco entra (menú más alto que la ventana), se
   * arrima al borde.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const maxX = window.innerWidth - MARGEN;
    const maxY = window.innerHeight - MARGEN;

    let nx = x;
    if (x + width > maxX) nx = x - width >= MARGEN ? x - width : Math.max(MARGEN, maxX - width);
    let ny = y;
    if (y + height > maxY) ny = y - height >= MARGEN ? y - height : Math.max(MARGEN, maxY - height);

    setPos({ x: nx, y: ny });
  }, [x, y, items]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // Cerca del borde derecho, el submenú se despliega hacia la izquierda para no
  // quedar fuera de la ventana.
  const haciaLaIzquierda =
    typeof window !== "undefined" && x + ANCHO_MENU * 2 > window.innerWidth;

  const clase = (item: MenuItem) =>
    [styles.item, item.danger ? styles.danger : "", item.disabled ? styles.disabled : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <div ref={ref} className={styles.menu} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((item) =>
        item.submenu ? (
          <div
            key={item.label}
            className={styles.itemWrap}
            onPointerEnter={() => !item.disabled && setAbierto(item.label)}
            onPointerLeave={() => setAbierto((a) => (a === item.label ? null : a))}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={abierto === item.label}
              disabled={item.disabled}
              title={item.title}
              className={clase(item)}
              onClick={() => !item.disabled && setAbierto(item.label)}
            >
              <span>{item.label}</span>
              <ChevronRight size={13} aria-hidden />
            </button>
            {abierto === item.label && item.submenu.length > 0 && (
              <div
                className={`${styles.submenu} ${haciaLaIzquierda ? styles.submenuIzq : ""}`}
                role="menu"
              >
                {item.submenu.map((sub) => (
                  <button
                    key={sub.label}
                    type="button"
                    role="menuitem"
                    title={sub.title}
                    className={clase(sub)}
                    onClick={() => {
                      onClose();
                      sub.onClick?.();
                    }}
                  >
                    <span className={styles.subLabel}>{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.title}
            className={clase(item)}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
