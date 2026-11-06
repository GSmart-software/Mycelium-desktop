"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMenuEmergente } from "@/lib/useMenuEmergente";
import styles from "./ContextMenu.module.css";

export type MenuItem = {
  label: string;
  danger?: boolean;
  /** Sin acción posible: se muestra apagado, no se oculta (así se descubre). */
  disabled?: boolean;
  /** Texto del tooltip; en una entrada deshabilitada, el motivo. */
  title?: string;
  /** Una línea divisoria antes de esta entrada, para separar grupos. */
  separadorAntes?: boolean;
  /** Entradas anidadas: la fila abre un submenú en vez de ejecutar una acción. */
  submenu?: MenuItem[];
  /**
   * Ícono a la izquierda del texto: los estados de una tarea (`FUN-S-01`) y las
   * acciones del explorador (`FUN-S-28`). También en las filas con submenú y
   * dentro del submenú.
   */
  icono?: ReactNode;
  /**
   * La opción vigente de un grupo excluyente (el estado actual de la tarea): se
   * anuncia como `menuitemradio` marcado y se resalta. Sin el campo, la entrada
   * es un `menuitem` común.
   */
  marcado?: boolean;
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

  // Clic afuera, Escape, flechas, foco en el primer ítem y un solo menú abierto:
  // lo mismo que los demás menús (`useMenuEmergente`). El «disparador» es lo
  // que tenía el foco al abrir —la fila del árbol, con teclado o con clic—, y
  // a eso vuelve el foco con Escape. `onClose` llega nuevo en cada render del
  // explorador: se lee por ref para que el efecto no se rehaga en cada uno (y
  // no devuelva el foco al primer ítem sin parar).
  const origenRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const cerrar = useCallback(() => onCloseRef.current(), []);
  useMenuEmergente({ abierto: true, cerrar, contenedorRef: ref, menuRef: ref, disparadorRef: origenRef });

  // Submenús con el teclado (`FUN-XL-04`, Parte 4): → (o Enter) sobre una fila
  // con submenú lo abre y lleva el foco a su primera entrada; ← o Esc lo
  // cierran y devuelven el foco a la fila; ↑/↓ recorren solo el submenú. Se
  // atiende acá, antes que `useMenuEmergente` (que escucha en `window`), y no
  // se deja seguir: si no, Esc cerraría el menú entero y las flechas saltarían
  // a las entradas del menú de afuera.
  const enfocarSubRef = useRef(false);
  useEffect(() => {
    if (!abierto || !enfocarSubRef.current) return;
    enfocarSubRef.current = false;
    ref.current?.querySelector<HTMLElement>("[data-submenu] button:not(:disabled)")?.focus();
  }, [abierto]);

  const abrirConTeclado = (label: string) => {
    enfocarSubRef.current = true;
    setAbierto(label);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const foco = document.activeElement as HTMLElement | null;
    const sub = foco?.closest<HTMLElement>("[data-submenu]");
    if (sub) {
      const items = [...sub.querySelectorAll<HTMLElement>("button:not(:disabled)")];
      const i = items.indexOf(foco!);
      let destino: HTMLElement | undefined;
      if (e.key === "ArrowLeft" || e.key === "Escape") {
        const disparador = sub.parentElement?.querySelector<HTMLElement>("[aria-haspopup='menu']");
        setAbierto(null);
        disparador?.focus();
      } else if (e.key === "ArrowDown") destino = items[(i + 1) % items.length];
      else if (e.key === "ArrowUp") destino = items[(i - 1 + items.length) % items.length];
      else if (e.key === "Home") destino = items[0];
      else if (e.key === "End") destino = items[items.length - 1];
      else return;
      destino?.focus();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const fila = foco?.closest<HTMLElement>("[data-con-submenu]");
    if (fila && e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const label = fila.dataset.conSubmenu!;
      if (!(fila as HTMLButtonElement).disabled) abrirConTeclado(label);
    }
  };

  // Cerca del borde derecho, el submenú se despliega hacia la izquierda para no
  // quedar fuera de la ventana.
  const haciaLaIzquierda =
    typeof window !== "undefined" && x + ANCHO_MENU * 2 > window.innerWidth;

  const clase = (item: MenuItem) =>
    [
      styles.item,
      item.danger ? styles.danger : "",
      item.disabled ? styles.disabled : "",
      item.separadorAntes ? styles.conSeparador : "",
      item.icono ? styles.conIcono : "",
      item.marcado ? styles.marcado : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onKeyDown={onKeyDown}
    >
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
              data-con-submenu={item.label}
              // Con Enter o Espacio (un clic sin puntero, `detail` 0), el foco
              // entra al submenú; con el mouse, se queda donde está.
              onClick={(e) => {
                if (item.disabled) return;
                if (e.detail === 0) abrirConTeclado(item.label);
                else setAbierto(item.label);
              }}
            >
              <span className={styles.conIcono}>
                {item.icono}
                {item.label}
              </span>
              <ChevronRight size={13} aria-hidden />
            </button>
            {abierto === item.label && item.submenu.length > 0 && (
              <div
                className={`${styles.submenu} ${haciaLaIzquierda ? styles.submenuIzq : ""}`}
                role="menu"
                data-submenu
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
                    {sub.icono}
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
            role={item.marcado === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.marcado}
            disabled={item.disabled}
            title={item.title}
            className={clase(item)}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.icono}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
