/**
 * Los atajos del catálogo de comandos (`FUN-XL-04`, Parte 1): cómo se escribe
 * uno, cómo se reconoce en un `KeyboardEvent`, cómo se muestra y cuáles están
 * reservados. Lógica pura, sin React ni stores, para que la pruebe
 * `scripts/test-comandos.mjs`.
 *
 * Un atajo se reconoce por la **tecla física** (`KeyboardEvent.code`) y no por
 * el carácter (`key`): la fila de números y el teclado numérico son atajos
 * distintos (`Digit1` frente a `Numpad1`), aunque `key` dé `"1"` en los dos
 * (regla del usuario, 2026-11-06). Para las letras, `code` depende de la
 * posición: en un teclado español la `ñ` es `Semicolon`.
 */

/**
 * Un atajo. `ctrl` es Ctrl en Windows y Linux y Cmd en macOS. Los
 * modificadores se comparan **exactos**: Ctrl+W no se dispara con Ctrl+Alt+W
 * (que en Windows es AltGr+W) ni con Ctrl+Shift+W.
 */
export type Atajo = {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** La tecla física, como la da `KeyboardEvent.code` («KeyW», «Digit1», «F12»). */
  code: string;
};

/** Lo que hace falta de un evento de teclado para reconocer un atajo. */
export type EventoTecla = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/** ¿El evento es este atajo? */
export function coincide(atajo: Atajo, e: EventoTecla): boolean {
  return (
    e.code === atajo.code &&
    !!atajo.ctrl === (e.ctrlKey || e.metaKey) &&
    !!atajo.shift === e.shiftKey &&
    !!atajo.alt === e.altKey
  );
}

/** ¿Son el mismo atajo? (Para detectar dos comandos con la misma tecla.) */
export function mismoAtajo(a: Atajo, b: Atajo): boolean {
  return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

// ── las teclas válidas ─────────────────────────────────────────────────────

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `Key${l}`);
const DIGITOS = "0123456789".split("").map((d) => `Digit${d}`);
const NUMERICO = "0123456789".split("").map((d) => `Numpad${d}`);
const FUNCION = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);

/** Lo que se ve de las teclas que no son letras, dígitos ni teclas F. */
const NOMBRE_TECLA: Record<string, string> = {
  Space: "Espacio",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Retroceso",
  Delete: "Supr",
  Insert: "Insert",
  Home: "Inicio",
  End: "Fin",
  PageUp: "RePág",
  PageDown: "AvPág",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "<",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
};

/** Todos los `code` que un atajo puede usar. */
export const CODES_VALIDOS: ReadonlySet<string> = new Set([
  ...LETRAS,
  ...DIGITOS,
  ...NUMERICO,
  ...FUNCION,
  ...Object.keys(NOMBRE_TECLA),
]);

/**
 * Las teclas de posición: su `code` es un **lugar** del teclado, y el carácter
 * impreso depende de la distribución (en una española, `Semicolon` es la `ñ` y
 * `Backslash` es la `ç`). Para estas —letras y puntuación— se muestra lo que
 * dice la distribución del usuario cuando se conoce (`distribucion.ts`).
 */
export const CODES_DE_POSICION: ReadonlySet<string> = new Set([
  ...LETRAS,
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "IntlBackslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
]);

/** El carácter impreso de cada tecla de posición en el teclado del usuario. */
export type Distribucion = ReadonlyMap<string, string>;

/**
 * El nombre visible de una tecla física: «W», «1», «Num 1», «Espacio», «\».
 * Con `distribucion`, las letras y la puntuación se muestran como las ve el
 * usuario («Ñ» para `Semicolon` en un teclado español). La fila de números y el
 * teclado numérico se muestran siempre distintos («1» y «Num 1»).
 */
export function nombreTecla(code: string, distribucion?: Distribucion): string {
  if (distribucion && CODES_DE_POSICION.has(code)) {
    const visto = distribucion.get(code);
    if (visto && visto.trim()) return visto.toLocaleUpperCase("es");
  }
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return NOMBRE_TECLA[code] ?? code;
}

/**
 * El atajo como se le muestra al usuario: «Ctrl+Shift+Espacio», «F1»,
 * «Ctrl+\». Sin `distribucion`, con el nombre de la tecla en un teclado de
 * EE. UU.; con ella, con el carácter del teclado del usuario.
 */
export function textoAtajo(a: Atajo, distribucion?: Distribucion): string {
  return [a.ctrl && "Ctrl", a.alt && "Alt", a.shift && "Shift", nombreTecla(a.code, distribucion)]
    .filter(Boolean)
    .join("+");
}

/** Una clave de texto única por atajo, para guardarlo o compararlo: «ctrl+shift+KeyP». */
export function claveAtajo(a: Atajo): string {
  return [a.ctrl && "ctrl", a.alt && "alt", a.shift && "shift", a.code].filter(Boolean).join("+");
}

/** El atajo con solo las claves encendidas, para guardarlo limpio. */
export function atajoLimpio(a: Atajo): Atajo {
  const limpio: Atajo = { code: a.code };
  if (a.ctrl) limpio.ctrl = true;
  if (a.alt) limpio.alt = true;
  if (a.shift) limpio.shift = true;
  return limpio;
}

/** Lo que venga de `localStorage` → un atajo válido, o `null`. */
export function atajoValido(crudo: unknown): Atajo | null {
  if (crudo === null || typeof crudo !== "object") return null;
  const o = crudo as Record<string, unknown>;
  if (typeof o.code !== "string" || !CODES_VALIDOS.has(o.code)) return null;
  return atajoLimpio({ code: o.code, ctrl: o.ctrl === true, alt: o.alt === true, shift: o.shift === true });
}

// ── grabar un atajo ────────────────────────────────────────────────────────

/** Las teclas que solas son un modificador: al grabar, se sigue esperando. */
const MODIFICADORES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "NumLock",
  "ContextMenu",
]);

/** ¿La tecla es solo un modificador (Ctrl, Shift, Alt, Windows)? */
export const esModificador = (code: string) => MODIFICADORES.has(code);

/**
 * La combinación de un evento, como la guarda Configuración: el `code` y los
 * modificadores exactos (Cmd cuenta como Ctrl). `null` si la tecla es solo un
 * modificador o no se puede usar en un atajo.
 */
export function atajoDeEvento(e: EventoTecla): Atajo | null {
  if (esModificador(e.code) || !CODES_VALIDOS.has(e.code)) return null;
  return atajoLimpio({ code: e.code, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey });
}

/** ¿Es una tecla F (F1…F24)? */
export const esTeclaF = (code: string) => /^F\d{1,2}$/.test(code);

/** ¿La tecla escribe un carácter? Letras, dígitos, puntuación, teclado numérico, espacio. */
export const teclaEscribe = (code: string) =>
  CODES_DE_POSICION.has(code) || code.startsWith("Digit") || code.startsWith("Numpad") || code === "Space";

/**
 * Lo que impide usar esta combinación como atajo, sin mirar los demás
 * comandos, o `null`. La regla de los dos modos (`FUN-XL-04`): mientras se
 * escribe solo actúan los atajos con Ctrl, Alt o una tecla F; una tecla sin
 * modificador —o con Shift solo— escribiría en el documento o es de la
 * navegación (Tab, flechas, Enter). Ctrl+Alt con una tecla que escribe es AltGr
 * en muchos teclados (`@`, `€`, `#`).
 */
export function problemaDeAtajo(a: Atajo): string | null {
  if (!CODES_VALIDOS.has(a.code)) return "Esa tecla no se puede usar en un atajo.";
  if (!a.ctrl && !a.alt && !esTeclaF(a.code)) {
    return teclaEscribe(a.code)
      ? "Una letra, un número o un signo sin Ctrl ni Alt escribiría en el documento. Agrega Ctrl o Alt (las teclas F sí pueden ir solas)."
      : `${textoAtajo(a)} sin Ctrl ni Alt es de la navegación y la escritura. Agrega Ctrl o Alt (las teclas F sí pueden ir solas).`;
  }
  if (a.ctrl && a.alt && teclaEscribe(a.code) && a.code !== "Space") {
    return "Ctrl+Alt con una letra, un número o un signo es AltGr en muchos teclados y escribe un carácter (@, €, #). Usa otra combinación.";
  }
  return null;
}

// ── las reservadas ─────────────────────────────────────────────────────────

/**
 * Teclas que ningún comando puede tener, salvo su dueño:
 * - **Alt+Tab**: cambiar de ventana en Windows. No es de nadie en Mycelium
 *   (regla del usuario, 2026-11-06).
 * - **Ctrl+Shift+Espacio**: la captura rápida de la Bandeja (`FUN-L-33`, regla
 *   del usuario, 2026-11-06).
 * - **F12** y **Ctrl+Shift+I**: las herramientas de desarrollo, que atiende
 *   `DevToolsHotkey` para todos (según el interruptor del vault).
 * - Las que se queda el sistema o WebView2: recargar la ventana (F5, Ctrl+R…),
 *   cerrarla, el menú Inicio, el Administrador de tareas.
 * - Las de editar texto en cualquier campo: copiar, pegar, cortar, todo,
 *   deshacer y rehacer.
 *
 * Los atajos configurables (`FUN-XL-04`, Parte 3) no dejan asignarlas.
 */
export const TECLAS_RESERVADAS: readonly { atajo: Atajo; duenio: string | null; motivo: string }[] = [
  { atajo: { alt: true, code: "Tab" }, duenio: null, motivo: "Cambiar de ventana en Windows" },
  {
    atajo: { ctrl: true, shift: true, code: "Space" },
    duenio: "bandeja.capturar",
    motivo: "La captura rápida de la Bandeja",
  },
  { atajo: { code: "F12" }, duenio: "dev.herramientas", motivo: "Las herramientas de desarrollo" },
  {
    atajo: { ctrl: true, shift: true, code: "KeyI" },
    duenio: "dev.herramientas",
    motivo: "Las herramientas de desarrollo",
  },
  { atajo: { code: "F5" }, duenio: null, motivo: "Recarga la ventana" },
  { atajo: { ctrl: true, code: "F5" }, duenio: null, motivo: "Recarga la ventana" },
  { atajo: { ctrl: true, code: "KeyR" }, duenio: null, motivo: "Recarga la ventana" },
  { atajo: { ctrl: true, shift: true, code: "KeyR" }, duenio: null, motivo: "Recarga la ventana" },
  { atajo: { alt: true, code: "F4" }, duenio: null, motivo: "Cierra la ventana" },
  { atajo: { ctrl: true, code: "Escape" }, duenio: null, motivo: "El menú Inicio de Windows" },
  { atajo: { ctrl: true, shift: true, code: "Escape" }, duenio: null, motivo: "El Administrador de tareas" },
  { atajo: { alt: true, code: "Space" }, duenio: null, motivo: "El menú de la ventana en Windows" },
  { atajo: { alt: true, code: "Escape" }, duenio: null, motivo: "Cambiar de ventana en Windows" },
  { atajo: { ctrl: true, code: "KeyC" }, duenio: null, motivo: "Copiar" },
  { atajo: { ctrl: true, code: "KeyV" }, duenio: null, motivo: "Pegar" },
  { atajo: { ctrl: true, code: "KeyX" }, duenio: null, motivo: "Cortar" },
  { atajo: { ctrl: true, code: "KeyA" }, duenio: null, motivo: "Seleccionar todo" },
  { atajo: { ctrl: true, code: "KeyZ" }, duenio: null, motivo: "Deshacer" },
  { atajo: { ctrl: true, code: "KeyY" }, duenio: null, motivo: "Rehacer" },
  { atajo: { ctrl: true, shift: true, code: "KeyZ" }, duenio: null, motivo: "Rehacer" },
];

/**
 * Si el atajo está reservado y `idComando` no es su dueño, la reserva; si no,
 * `null`.
 */
export function reservaQueChoca(atajo: Atajo, idComando: string) {
  return TECLAS_RESERVADAS.find((r) => mismoAtajo(r.atajo, atajo) && r.duenio !== idComando) ?? null;
}
