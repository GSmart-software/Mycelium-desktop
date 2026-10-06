/**
 * Estados de tarea (`FUN-S-01`): el símbolo dentro de `[ ]` de una lista de
 * tareas dice en qué estado está, con los mismos símbolos que los temas de
 * Obsidian —así el vault sigue siendo intercambiable—.
 *
 * Módulo **puro** (sin imports): lo usan la vista en vivo (`lib/editor/tareas.ts`
 * y `livePreview`), la de lectura (`lib/markdown.ts`), el menú de estados y los
 * tests (`scripts/test-estados-tarea.mjs`), que lo transpilan sin la app.
 *
 * Cómo se ve cada estado lo decide el CSS (`styles/editor.css`, sección «Estados
 * de tarea»), por el atributo `data-estado="<id>"` de la casilla: la misma
 * regla dibuja la casilla en vivo, en lectura, en el PDF y en el menú.
 */

export type IdEstadoTarea =
  | "pendiente"
  | "hecha"
  | "cancelada"
  | "destacada"
  | "agregada"
  | "en-curso"
  | "pospuesta"
  | "pregunta"
  | "importante";

export type EstadoTarea = {
  id: IdEstadoTarea;
  /** El símbolo canónico, el que se escribe al elegirlo en el menú. */
  simbolo: string;
  /** Nombre visible (menú, tooltip). */
  nombre: string;
};

/** Los estados, en el orden en que aparecen en el menú. */
export const ESTADOS_TAREA: readonly EstadoTarea[] = [
  { id: "pendiente", simbolo: " ", nombre: "Pendiente" },
  { id: "hecha", simbolo: "x", nombre: "Hecha" },
  { id: "en-curso", simbolo: "/", nombre: "En curso" },
  { id: "cancelada", simbolo: "-", nombre: "Cancelada" },
  { id: "pospuesta", simbolo: ">", nombre: "Pospuesta" },
  { id: "destacada", simbolo: "*", nombre: "Destacada" },
  { id: "importante", simbolo: "!", nombre: "Importante" },
  { id: "pregunta", simbolo: "?", nombre: "Pregunta" },
  { id: "agregada", simbolo: "+", nombre: "Agregada" },
];

const POR_SIMBOLO = new Map<string, EstadoTarea>(ESTADOS_TAREA.map((e) => [e.simbolo, e]));
POR_SIMBOLO.set("X", POR_SIMBOLO.get("x")!);

/**
 * Qué cuenta como símbolo de tarea: **un** carácter cualquiera salvo los
 * corchetes, la barra invertida (escaparía al `]`) y los saltos o tabuladores.
 * Es lo que acepta Obsidian; la condición la comparten el parser de la vista en
 * vivo y el plugin de la de lectura, o una misma línea sería tarea en una vista
 * y texto en la otra.
 */
export const SIMBOLO_TAREA = "[^\\[\\]\\\\\\r\\n\\t]";

/** `[c]` seguido de espacio o tabulador, al principio del contenido de un ítem. */
export const MARCADOR_TAREA_RE = new RegExp(`^\\[(${SIMBOLO_TAREA})\\][ \\t]`);

/** ¿Estos tres caracteres son un marcador de tarea `[c]`? */
export function esMarcadorDeTarea(tres: string): boolean {
  return new RegExp(`^\\[${SIMBOLO_TAREA}\\]$`).test(tres);
}

/**
 * El estado de un símbolo. Uno desconocido se ve **como hecha** —es lo que hace
 * Obsidian: cualquier cosa que no sea un espacio marca la casilla—.
 */
export function estadoDeSimbolo(simbolo: string): EstadoTarea {
  return POR_SIMBOLO.get(simbolo) ?? POR_SIMBOLO.get("x")!;
}

/** ¿La casilla cuenta como marcada? Todo lo que no es un espacio. */
export function estaMarcada(simbolo: string): boolean {
  return simbolo !== " ";
}

/**
 * Qué símbolo deja un clic en la casilla. Como en Obsidian: la pendiente pasa a
 * hecha, y **cualquier** otro estado —también los especiales— vuelve a
 * pendiente. El menú del clic derecho es para elegir los demás.
 */
export function simboloAlClic(simbolo: string): string {
  return simbolo === " " ? "x" : " ";
}

/**
 * El texto del ítem lleva estilo propio solo en dos estados: hecha (tachado y
 * atenuado) y cancelada (más atenuado). El resto solo cambia la casilla.
 */
export function estiloDeTexto(simbolo: string): "hecha" | "cancelada" | null {
  if (simbolo === " ") return null;
  const { id } = estadoDeSimbolo(simbolo);
  if (id === "cancelada") return "cancelada";
  if (id === "hecha") return "hecha";
  return null;
}

/**
 * Cambia el símbolo del marcador que empieza en `pos` (el `[`) dentro de
 * `texto`. Devuelve el texto nuevo, o `null` si en `pos` no hay un marcador —el
 * documento cambió desde que se dibujó la casilla—: mejor no tocar nada que
 * escribir sobre otra cosa.
 */
export function cambiarSimboloEn(texto: string, pos: number, nuevo: string): string | null {
  if (!esMarcadorDeTarea(texto.slice(pos, pos + 3))) return null;
  if (!new RegExp(`^${SIMBOLO_TAREA}$`).test(nuevo)) return null;
  return texto.slice(0, pos + 1) + nuevo + texto.slice(pos + 2);
}
