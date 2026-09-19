import { useEffect, useId, type RefObject } from "react";

/**
 * Comportamiento de un menú emergente que se abre desde un botón («Más
 * opciones», el menú del pane…). Antes cada menú resolvía solo el clic afuera,
 * y el resto faltaba (critique 2026-09-19): Escape no cerraba, el foco se
 * quedaba en el botón, las flechas no recorrían los ítems y se podían tener dos
 * menús abiertos a la vez. `ContextMenu` ya cerraba con Escape; esto lo lleva
 * a los demás y agrega lo que tampoco él hacía.
 *
 * - Clic afuera del contenedor: cierra.
 * - Escape: cierra y devuelve el foco al disparador.
 * - Tab: cierra y deja que el foco siga su camino natural.
 * - Flechas arriba/abajo, Inicio y Fin: recorren los ítems (con vuelta).
 * - Al abrir, el foco va al primer ítem.
 * - Uno solo a la vez: al abrirse, avisa a los demás para que se cierren.
 */
const EVENTO_MENU_ABIERTO = "mic-menu-abierto";

/** Lo que dentro del menú puede recibir el foco con las flechas. */
const ITEMS = "button:not(:disabled), input:not(:disabled), [role='menuitem']:not([aria-disabled='true'])";

export function useMenuEmergente({
  abierto,
  cerrar,
  contenedorRef,
  menuRef,
  disparadorRef,
}: {
  abierto: boolean;
  cerrar: () => void;
  /** Envuelve disparador y menú: un clic adentro no cierra. */
  contenedorRef: RefObject<HTMLElement | null>;
  /** El panel del menú: de acá salen los ítems que recorren las flechas. */
  menuRef: RefObject<HTMLElement | null>;
  disparadorRef: RefObject<HTMLElement | null>;
}) {
  const id = useId();

  useEffect(() => {
    if (!abierto) return;

    const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    // El panel se monta en este mismo render: el foco va en el cuadro siguiente.
    const cuadro = requestAnimationFrame(() => items()[0]?.focus());

    window.dispatchEvent(new CustomEvent(EVENTO_MENU_ABIERTO, { detail: id }));
    const onOtroAbierto = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) cerrar();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) cerrar();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar();
        disparadorRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        cerrar();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const lista = items();
      if (!lista.length) return;
      e.preventDefault();
      const actual = lista.indexOf(document.activeElement as HTMLElement);
      const siguiente =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? lista.length - 1
            : e.key === "ArrowDown"
              ? (actual + 1) % lista.length
              : (actual - 1 + lista.length) % lista.length;
      lista[siguiente].focus();
    };

    window.addEventListener(EVENTO_MENU_ABIERTO, onOtroAbierto);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener(EVENTO_MENU_ABIERTO, onOtroAbierto);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [abierto, cerrar, contenedorRef, menuRef, disparadorRef, id]);
}
