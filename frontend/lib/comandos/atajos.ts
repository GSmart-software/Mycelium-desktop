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

/** El nombre visible de una tecla física: «W», «1», «Num 1», «Espacio», «\». */
export function nombreTecla(code: string): string {
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return NOMBRE_TECLA[code] ?? code;
}

/**
 * El atajo como se le muestra al usuario: «Ctrl+Shift+Espacio», «F1»,
 * «Ctrl+\». Con el nombre de la tecla en un teclado de EE. UU.; mostrar el
 * carácter del teclado del usuario es de la Parte 3 (atajos configurables).
 */
export function textoAtajo(a: Atajo): string {
  return [a.ctrl && "Ctrl", a.alt && "Alt", a.shift && "Shift", nombreTecla(a.code)].filter(Boolean).join("+");
}

// ── las reservadas ─────────────────────────────────────────────────────────

/**
 * Teclas que ningún comando puede tener (regla del usuario, 2026-11-06), salvo
 * su dueño:
 * - **Alt+Tab**: cambiar de ventana en Windows. No es de nadie en Mycelium.
 * - **Ctrl+Shift+Espacio**: la captura rápida de la Bandeja (`FUN-L-33`).
 *
 * Los atajos configurables (Parte 3) tienen que impedir asignarlas.
 */
export const TECLAS_RESERVADAS: readonly { atajo: Atajo; duenio: string | null; motivo: string }[] = [
  { atajo: { alt: true, code: "Tab" }, duenio: null, motivo: "Cambiar de ventana en Windows" },
  {
    atajo: { ctrl: true, shift: true, code: "Space" },
    duenio: "bandeja.capturar",
    motivo: "La captura rápida de la Bandeja",
  },
];

/**
 * Si el atajo está reservado y `idComando` no es su dueño, la reserva; si no,
 * `null`.
 */
export function reservaQueChoca(atajo: Atajo, idComando: string) {
  return TECLAS_RESERVADAS.find((r) => mismoAtajo(r.atajo, atajo) && r.duenio !== idComando) ?? null;
}
