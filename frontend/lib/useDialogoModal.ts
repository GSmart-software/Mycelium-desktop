import { useEffect, type RefObject } from "react";

/**
 * Comportamiento de un diálogo modal (`role="dialog"` + `aria-modal`). El modal
 * Compartir no lo tenía (critique 2026-09-19): Escape no cerraba y el foco se
 * quedaba en el botón que lo abrió, detrás del velo.
 *
 * - Al abrir, el foco va al primer control del diálogo.
 * - Tab y Shift+Tab quedan dentro del diálogo (lo que hay detrás está tapado).
 * - Escape cierra.
 * - Al cerrar, el foco vuelve a donde estaba antes de abrir.
 */
const FOCUSABLES =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function useDialogoModal({
  abierto,
  cerrar,
  dialogoRef,
}: {
  abierto: boolean;
  cerrar: () => void;
  dialogoRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!abierto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const focusables = () => [...(dialogoRef.current?.querySelectorAll<HTMLElement>(FOCUSABLES) ?? [])];
    const cuadro = requestAnimationFrame(() => {
      // El primer campo, no la «×» de cerrar: es lo que se viene a hacer.
      const lista = focusables();
      (lista.find((el) => el.tagName !== "BUTTON") ?? lista[0])?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = focusables();
      if (!lista.length) return;
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (!dialogoRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        primero.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("keydown", onKeyDown);
      anterior?.focus?.();
    };
  }, [abierto, cerrar, dialogoRef]);
}
