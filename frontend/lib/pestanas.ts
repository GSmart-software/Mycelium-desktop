import type { LucideIcon } from "lucide-react";
import {
  ICONO_CALENDARIO,
  ICONO_CONSOLA,
  ICONO_GRAFO,
  ICONO_OTRO_ARCHIVO,
  ICONO_POR_TIPO,
  ICONO_REFERENCIAS,
} from "@/lib/iconosDeTipo";
import { esTabArchivo, nombreDeRuta, rutaDeTabArchivo } from "@/lib/otrosArchivos";
import { esTabTerminal, termIdDe } from "@/lib/terminalBase";
import type { NotaTipo } from "@/stores/vaultStore";

/**
 * Qué es cada pestaña, en un solo sitio.
 *
 * El árbol de pestañas guarda un `notaId`, pero no toda pestaña es una nota: el
 * grafo, las referencias del vault, el calendario, una consola y el visor de un
 * archivo que Mycelium no indexa viajan con **ids sentinela** (ver «Ids
 * sentinela» en `docs/aprendizajes/Estado con Zustand.md`). Hasta la auditoría
 * del 2026-09-26 la pregunta «¿qué es esta pestaña?» se contestaba en cuatro
 * componentes con listas paralelas, y dos de ellas no sabían de las referencias.
 * Acá viven los ids, el discriminador y el título/ícono de cada tipo; quien
 * necesite decidir algo por tipo pregunta acá y no repite la lista.
 *
 * Los prefijos de consola y archivo los siguen definiendo sus módulos
 * (`lib/terminalBase`, `lib/otrosArchivos`), que no dependen de nada del
 * workspace, así que importarlos desde acá no cierra ningún ciclo.
 */

/** Pestaña del grafo global: una ventana más del área de panes, no una nota. */
export const GRAPH_TAB_ID = "graph:global";

/** Pestaña de la pantalla de referencias del vault (`FUN-L-17`). */
export const ENLACES_TAB_ID = "enlaces:global";

/**
 * Pestaña del calendario de recordatorios (`FUN-L-22`). Como la del grafo: un id
 * reservado que se mueve, divide y cierra como cualquier pestaña pero nunca es
 * de preview ni se descarta al reconciliar.
 */
export const CALENDAR_TAB_ID = "calendario:global";

export type TipoDePestana = "nota" | "grafo" | "enlaces" | "calendario" | "terminal" | "archivo";

/** Qué es la pestaña con ese `notaId`. Lo que no es sentinela es una nota del vault. */
export function tipoDePestana(notaId: string): TipoDePestana {
  if (notaId === GRAPH_TAB_ID) return "grafo";
  if (notaId === ENLACES_TAB_ID) return "enlaces";
  if (notaId === CALENDAR_TAB_ID) return "calendario";
  if (esTabTerminal(notaId)) return "terminal";
  if (esTabArchivo(notaId)) return "archivo";
  return "nota";
}

/**
 * Ids que no son notas del vault. No pueden ser pestaña de preview ni entrar en
 * una línea de historial (reemplazar una consola mata su sesión; un archivo
 * suelto no es un destino de navegación), y nunca se descartan al reconciliar
 * contra el índice, que solo conoce notas.
 */
export const esSentinela = (notaId: string) => tipoDePestana(notaId) !== "nota";

/**
 * Título e ícono de cada pestaña que no es nota. Para consola y archivo el
 * título de la tabla es el de respaldo: el real lo dan la sesión y la ruta.
 */
export const PESTANA_SENTINELA: Record<
  Exclude<TipoDePestana, "nota">,
  { titulo: string; icono: LucideIcon }
> = {
  grafo: { titulo: "Grafo de conexiones", icono: ICONO_GRAFO },
  enlaces: { titulo: "Referencias del vault", icono: ICONO_REFERENCIAS },
  calendario: { titulo: "Calendario", icono: ICONO_CALENDARIO },
  terminal: { titulo: "Terminal", icono: ICONO_CONSOLA },
  archivo: { titulo: "Archivo", icono: ICONO_OTRO_ARCHIVO },
};

/**
 * Título de una pestaña. Los sentinela se resuelven **antes** de mirar `notas`
 * porque ninguno tiene fila ahí: la consola toma el título de su sesión, el
 * archivo no indexado el nombre de su ruta (`FUN-L-11`), el resto el de la tabla.
 * Una nota cuyo índice todavía no llegó muestra «…».
 */
export function tituloDePestana(
  notaId: string,
  notas: readonly { id: string; titulo: string }[],
  sesiones: Readonly<Record<string, { titulo: string }>>,
): string {
  const tipo = tipoDePestana(notaId);
  if (tipo === "nota") return notas.find((n) => n.id === notaId)?.titulo ?? "…";
  if (tipo === "terminal") return sesiones[termIdDe(notaId)]?.titulo ?? PESTANA_SENTINELA.terminal.titulo;
  if (tipo === "archivo") return nombreDeRuta(rutaDeTabArchivo(notaId));
  return PESTANA_SENTINELA[tipo].titulo;
}

/**
 * Ícono de una pestaña (`FUN-S-11`). Una nota toma el de su tipo; si todavía no
 * llegó el índice, el de markdown, que es lo que casi siempre resulta ser.
 */
export function iconoDePestana(
  notaId: string,
  notas: readonly { id: string; tipo: NotaTipo }[],
): LucideIcon {
  const tipo = tipoDePestana(notaId);
  if (tipo !== "nota") return PESTANA_SENTINELA[tipo].icono;
  return ICONO_POR_TIPO[notas.find((n) => n.id === notaId)?.tipo ?? "markdown"];
}
