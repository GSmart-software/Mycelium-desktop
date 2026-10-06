"use client";

import type { MenuItem } from "@/components/explorer/ContextMenu";
import { ESTADOS_TAREA, estadoDeSimbolo } from "@/lib/estadosTarea";
import { abrirMenuFlotante } from "@/components/editor/MenuFlotante";

/**
 * Las entradas del menú de estados de una tarea (`FUN-S-01`): una por estado,
 * con su ícono y su nombre, y el vigente marcado. Lo usan la vista de lectura
 * (`NoteEditor`, clic derecho sobre la casilla) y la vista en vivo (el widget de
 * la casilla, con `abrirMenuEstadosTarea`).
 *
 * El ícono es la **misma casilla** que se ve en la nota —un `span` con la clase
 * `mic-tarea-icono` y su `data-estado`, dibujado por las reglas de
 * `editor.css`—: así el menú no puede mostrar un ícono distinto del que deja.
 */
export function itemsEstadosTarea(simboloActual: string, elegir: (simbolo: string) => void): MenuItem[] {
  const actual = estadoDeSimbolo(simboloActual).id;
  return ESTADOS_TAREA.map((e) => ({
    label: e.nombre,
    title: `[${e.simbolo}]`,
    marcado: e.id === actual,
    icono: <span className="mic-tarea-icono" data-estado={e.id} aria-hidden />,
    onClick: () => elegir(e.simbolo),
  }));
}

export function abrirMenuEstadosTarea(
  x: number,
  y: number,
  simboloActual: string,
  elegir: (simbolo: string) => void,
): void {
  abrirMenuFlotante(x, y, itemsEstadosTarea(simboloActual, elegir));
}
