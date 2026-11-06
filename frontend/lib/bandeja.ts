/**
 * La Bandeja y la captura rápida (`FUN-L-33`): la lógica pura.
 *
 * La Bandeja del vault es una nota común (`Bandeja.md` en la raíz, o la ruta que
 * se configure en Configuración → Vault) donde la captura rápida
 * (Ctrl+Shift+Espacio) anota lo que hay que no olvidar, sin decidir dónde va.
 * Cada día abre su encabezado y cada entrada es un ítem de lista con la hora:
 *
 * ```markdown
 * ## 2026-11-05
 * - 09:40 La panadería prefiere hablar por la tarde
 * - [ ] 10:05 Renovar el dominio antes del 15
 * ```
 *
 * Acá vive todo lo que se puede decidir sin el vault —qué es una tarea, cómo se
 * agrega una entrada al final, cuántas entradas sin procesar hay, qué ruta es
 * válida—, sin imports de la app, para que `scripts/test-bandeja.mjs` lo pruebe
 * sin navegador ni Tauri. Lo que toca el disco está en `lib/bandejaVault.ts`.
 */
import { estadoDeSimbolo } from "@/lib/estadosTarea";

/** Ruta de la Bandeja del vault si no se configuró otra. */
export const RUTA_BANDEJA_DEFECTO = "Bandeja.md";

/** Lo que dice el menú (y el MCP) al intentar renombrarla. */
export const MOTIVO_NO_RENOMBRA = "La Bandeja no se renombra";
/** … al intentar mandarla a la papelera. */
export const MOTIVO_NO_ELIMINA = "La Bandeja no se elimina";
/** … al intentar moverla a otra carpeta. */
export const MOTIVO_NO_MUEVE = "La Bandeja no se mueve: su ubicación se cambia en Configuración → Vault";

/**
 * Normaliza la ruta configurada de la Bandeja a una ruta relativa POSIX del
 * vault terminada en `.md`, o `null` si no es válida. Como la carpeta de
 * Esporas: nada de rutas absolutas ni de `..`, y tampoco carpetas ocultas
 * (`.mycelium/`, `.claude/`): lo que empieza con punto no se indexa y la Bandeja
 * es una nota del vault. Sin extensión se le pone `.md`; con otra (`.txt`), no
 * sirve.
 */
export function normalizarRutaBandeja(ruta: string): string | null {
  const bruto = (ruta ?? "").trim().replace(/\\/g, "/");
  if (bruto === "") return null;
  if (bruto.startsWith("/") || /^[a-zA-Z]:/.test(bruto)) return null;
  const segmentos = bruto
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (segmentos.length === 0) return null;
  if (segmentos.some((s) => s === "." || s === ".." || s.startsWith("."))) return null;
  // Los caracteres que un nombre de archivo no admite en Windows.
  if (segmentos.some((s) => /[?:*|"<>]/.test(s))) return null;
  let ultimo = segmentos[segmentos.length - 1];
  const punto = ultimo.lastIndexOf(".");
  const ext = punto > 0 ? ultimo.slice(punto).toLowerCase() : "";
  if (ext === ".md") ultimo = `${ultimo.slice(0, punto)}.md`;
  // Otra extensión de archivo (`.txt`, `.canvas`) no es una nota; un punto
  // que no es extensión (`Notas v2.1`) es parte del nombre.
  else if (/^\.[a-z]{2,8}$/.test(ext)) return null;
  else ultimo = `${ultimo}.md`;
  if (ultimo === ".md") return null;
  segmentos[segmentos.length - 1] = ultimo;
  return segmentos.join("/");
}

/**
 * ¿`id` (la ruta de una nota) es la Bandeja que está en `ruta`? Sin distinguir
 * mayúsculas: en Windows y macOS `bandeja.md` y `Bandeja.md` son el mismo
 * archivo, y protegerla solo con la forma exacta dejaría un agujero.
 */
export function esRutaBandeja(id: string, ruta: string): boolean {
  return id.toLowerCase() === ruta.toLowerCase();
}

/** ¿La carpeta `carpetaId` contiene (a cualquier profundidad) la Bandeja en `ruta`? */
export function carpetaContieneRuta(carpetaId: string, ruta: string): boolean {
  return ruta.toLowerCase().startsWith(`${carpetaId.toLowerCase()}/`);
}

/**
 * La ruta de la Bandeja después de que la carpeta `de` pase a llamarse `a`
 * (renombrarla o moverla), o `null` si la Bandeja no estaba adentro. La
 * preferencia sigue a la carpeta: si no, la próxima captura crearía otra
 * Bandeja vacía en la ruta vieja.
 */
export function rutaTrasMoverCarpeta(ruta: string, de: string, a: string): string | null {
  if (!carpetaContieneRuta(de, ruta)) return null;
  return `${a}/${ruta.slice(de.length + 1)}`;
}

/** Lo que se va a anotar: una nota o una tarea, y su texto sin el `[]`. */
export type Captura = { tipo: "nota" | "tarea"; texto: string };

/** `[]` o `[ ]` al principio: la captura entra como tarea. */
const PREFIJO_TAREA = /^\[ ?\][ \t]*/;

/**
 * Interpreta lo que se escribió en la cajita. Los saltos de línea se vuelven
 * espacios (la entrada es UN ítem de lista: un salto la partiría en una línea
 * que ya no es parte del ítem). `null` si no queda nada que anotar —tampoco un
 * `[]` solo—.
 */
export function interpretarCaptura(crudo: string): Captura | null {
  const limpio = (crudo ?? "").replace(/[\r\n]+/g, " ").trim();
  const tarea = PREFIJO_TAREA.test(limpio);
  const texto = (tarea ? limpio.replace(PREFIJO_TAREA, "") : limpio).trim();
  if (texto === "") return null;
  return { tipo: tarea ? "tarea" : "nota", texto };
}

/** ¿Lo escrito hasta ahora entraría como tarea? Para la etiqueta de la cajita. */
export function esCapturaDeTarea(crudo: string): boolean {
  return PREFIJO_TAREA.test((crudo ?? "").trimStart());
}

const dos = (n: number) => String(n).padStart(2, "0");

/** La fecha local `AAAA-MM-DD` del encabezado del día. */
export function fechaDelDia(ahora: Date): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/** La hora local `HH:MM` de la entrada. */
export function horaDeEntrada(ahora: Date): string {
  return `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`;
}

/** La línea de la entrada, sin salto: `- HH:MM texto` o `- [ ] HH:MM texto`. */
export function lineaDeEntrada(captura: Captura, ahora: Date): string {
  const marca = captura.tipo === "tarea" ? "- [ ] " : "- ";
  return `${marca}${horaDeEntrada(ahora)} ${captura.texto}`;
}

/** Un encabezado Markdown de cualquier nivel (fuera de un bloque de código). */
const ENCABEZADO = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
/** Apertura o cierre de un bloque de código cercado. */
const CERCA = /^ {0,3}(`{3,}|~{3,})/;

/**
 * El último encabezado del texto, fuera de los bloques de código, ya sin
 * espacios a los costados (`## 2026-11-05`), o `null` si no hay.
 */
function ultimoEncabezado(lineas: readonly string[]): string | null {
  let cerca: string | null = null;
  let ultimo: string | null = null;
  for (const linea of lineas) {
    const c = CERCA.exec(linea);
    if (c) {
      if (cerca === null) cerca = c[1][0];
      else if (c[1][0] === cerca) cerca = null;
      continue;
    }
    if (cerca === null && ENCABEZADO.test(linea)) ultimo = linea.trim();
  }
  return ultimo;
}

/**
 * Agrega la entrada **al final** de `contenido`, bajo el encabezado del día.
 *
 * Nada de lo que ya había se reescribe: el resultado empieza siempre con el
 * contenido anterior tal cual (a lo sumo, con el salto de línea final que le
 * faltaba). Si el último encabezado del archivo no es el de hoy —porque es el
 * primer apunte del día, o porque el usuario escribió otra sección debajo—, se
 * agrega `## AAAA-MM-DD` antes de la entrada, separado por una línea en blanco.
 * Así cada entrada queda siempre bajo el encabezado de su día, aunque el archivo
 * se haya editado a mano en otro formato.
 *
 * Respeta los saltos del archivo: si usa CRLF, lo agregado también.
 */
export function agregarEntrada(contenido: string, captura: Captura, ahora: Date): string {
  const previo = contenido ?? "";
  const eol = previo.includes("\r\n") ? "\r\n" : "\n";
  const lineas = previo.split(/\r?\n/);
  const encabezado = `## ${fechaDelDia(ahora)}`;
  const entrada = lineaDeEntrada(captura, ahora);

  let salida = previo;
  if (salida !== "" && !salida.endsWith("\n")) salida += eol;
  if (ultimoEncabezado(lineas) !== encabezado) {
    // Una línea en blanco antes del encabezado, salvo al principio del archivo
    // o si ya la hay.
    const vacio = salida.trim() === "";
    if (vacio) salida = "";
    else if (!/\r?\n\s*\r?\n$/.test(salida)) salida += eol;
    salida += encabezado + eol;
  }
  return salida + entrada + eol;
}

/** Un ítem de lista (`-`, `*`, `+` o numerado), con lo que sigue al marcador. */
const ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
/** La casilla de tarea al principio del contenido del ítem. */
const CASILLA = /^\[([^\[\]\\\r\n\t])\](?:[ \t]|$)/;

/**
 * Cuántas entradas **sin procesar** tiene la Bandeja: cada ítem de lista
 * cuenta uno —notas y tareas, no días—, salvo las tareas hechas (`[x]`) y las
 * canceladas (`[-]`), que ya están procesadas. Un símbolo desconocido se ve
 * como hecha (`estadoDeSimbolo`, como en Obsidian) y tampoco cuenta. Lo que
 * está dentro de un bloque de código o en el frontmatter no es una entrada.
 */
export function contarEntradas(contenido: string): number {
  const lineas = (contenido ?? "").split(/\r?\n/);
  let i = 0;
  // Frontmatter: solo si el archivo arranca con `---` y se cierra.
  if (lineas[0]?.trim() === "---") {
    const fin = lineas.findIndex((l, j) => j > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (fin > 0) i = fin + 1;
  }
  let cerca: string | null = null;
  let total = 0;
  for (; i < lineas.length; i++) {
    const linea = lineas[i];
    const c = CERCA.exec(linea);
    if (c) {
      if (cerca === null) cerca = c[1][0];
      else if (c[1][0] === cerca) cerca = null;
      continue;
    }
    if (cerca !== null) continue;
    // `* * *` o `- - -` es una línea horizontal, no un ítem.
    if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(linea)) continue;
    const item = ITEM.exec(linea);
    if (!item || item[1].trim() === "") continue;
    const casilla = CASILLA.exec(item[1]);
    if (casilla) {
      const estado = estadoDeSimbolo(casilla[1]).id;
      if (estado === "hecha" || estado === "cancelada") continue;
    }
    total++;
  }
  return total;
}

/** El aviso breve al anotar. */
export function textoAvisoCaptura(captura: Captura): string {
  return `${captura.tipo === "tarea" ? "Tarea anotada" : "Anotado"} en la Bandeja del vault`;
}
