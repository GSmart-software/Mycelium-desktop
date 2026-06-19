import { useEffect, type RefObject } from "react";

/**
 * Permite scrollear horizontalmente un contenedor con la rueda del ratón
 * (la rueda vertical se traduce a scrollLeft). Útil para barras que desbordan
 * en horizontal, como la de pestañas. No hace nada si no hay overflow.
 */
export function useWheelHScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Respetar el scroll horizontal nativo (trackpad / Shift+rueda).
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return; // no hay overflow horizontal
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
