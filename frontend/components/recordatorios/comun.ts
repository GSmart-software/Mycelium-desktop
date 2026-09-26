"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { manejarClicDeEnlace } from "@/lib/enlacesExternos";
import { aDate, type Ocurrencia, type Repeticion } from "@/lib/recordatorios";
import { CALENDAR_TAB_ID } from "@/lib/pestanas";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * Piezas comunes del calendario (`FUN-L-22`): la navegación de los
 * `[[enlaces]]` del detalle y los textos de fecha que comparten la pestaña, el
 * panel, el modal y la tarjeta.
 */

/**
 * Los `[[enlaces]]` de un recordatorio se resuelven contra el vault como en una
 * nota cualquiera: `abrir` abre la nota (y avisa con `alAbrir`, para cerrar lo
 * que tape) y `existe` es lo que pinta un enlace roto.
 */
export function useEnlacesDelVault(alAbrir?: () => void) {
  const router = useRouter();
  const abrir = useCallback(
    (titulo: string) => {
      const { notas, carpetas } = useVaultStore.getState();
      const destino = resolveWikilink(titulo, notas, carpetas);
      if (!destino) return;
      useTabsStore.getState().openNote(destino.id);
      router.replace(`/workspace?note=${destino.id}`);
      alAbrir?.();
    },
    [router, alAbrir],
  );
  const existe = useCallback((titulo: string) => {
    const { notas, carpetas } = useVaultStore.getState();
    return resolveWikilink(titulo, notas, carpetas) !== undefined;
  }, []);

  /** Clic dentro del detalle renderizado: enlaces del vault y de la web. */
  const onClicDetalle = useCallback(
    (event: React.MouseEvent) => {
      const a = (event.target as HTMLElement).closest("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      // Un enlace a la web va al navegador del sistema (`DEF-101`).
      if (manejarClicDeEnlace(event, href)) return;
      if (href.startsWith("#wikilink:")) {
        event.preventDefault();
        abrir(decodeURIComponent(href.slice("#wikilink:".length)));
      } else if (href.startsWith("#")) {
        event.preventDefault();
      }
    },
    [abrir],
  );

  return { abrir, existe, onClicDetalle };
}

/** Abre (o enfoca) la pestaña del calendario. */
export function useAbrirCalendario() {
  const router = useRouter();
  return useCallback(() => {
    useTabsStore.getState().openNote(CALENDAR_TAB_ID);
    router.replace(`/workspace?note=${CALENDAR_TAB_ID}`);
  }, [router]);
}

const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const INICIALES_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
export const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «vie 25 sep». */
export function fechaCorta(fecha: string): string {
  const d = aDate(fecha);
  return `${DIAS_CORTOS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

/** «viernes 25 de septiembre de 2026». */
export function fechaCompleta(fecha: string): string {
  return aDate(fecha).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** «10:30» o «Todo el día». */
export function horaDe(o: Ocurrencia): string {
  return o.recordatorio.hora ?? "Todo el día";
}

/** Cómo se lee la repetición de un recordatorio, con su referencia concreta. */
export function describirRepeticion(repeticion: Repeticion, fecha: string): string | null {
  const d = aDate(fecha);
  switch (repeticion) {
    case "ninguna":
      return null;
    case "dia":
      return "Se repite cada día";
    case "semana":
      return `Se repite cada ${DIAS_SEMANA[(d.getDay() + 6) % 7].toLowerCase()}`;
    case "mes":
      return `Se repite cada mes, el día ${d.getDate()}`;
    case "anio":
      return `Se repite cada año, el ${d.toLocaleDateString("es", { day: "numeric", month: "long" })}`;
  }
}
