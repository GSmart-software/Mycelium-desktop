/**
 * Crear con el teclado (`FUN-XL-04`, Parte 4): qué se puede crear, con qué
 * nombre y con qué comando, y cómo se mueve el menú «Nuevo…» (Ctrl+Shift+N)
 * con las teclas.
 *
 * Lógica pura —sin React, sin stores, sin íconos— para que la pruebe
 * `scripts/test-comandos.mjs`. Lo que crea de verdad está en `lib/crear.ts`;
 * el diálogo, en `components/workspace/DialogoNuevo.tsx`; los menús del
 * explorador toman de acá los mismos textos.
 */

/** Lo que se crea como un archivo del vault (más la carpeta). */
export type TipoNuevo = "nota" | "carpeta" | "lienzo" | "tabla" | "dibujo" | "diagrama";

/** Una opción del menú «Nuevo…»: un tipo, o el paso a las Esporas. */
export type OpcionNuevo = {
  tipo: TipoNuevo | "espora";
  /** El comando del catálogo que hace lo mismo (`crear.lienzo`…). */
  comando: string;
  titulo: string;
  /** Lo que es, en pocas palabras (el explorador lo muestra entre paréntesis). */
  detalle?: string;
};

/**
 * Las opciones del menú «Nuevo…», en su orden: lo más común primero. Los
 * títulos son los de los botones y menús del explorador, para que una misma
 * cosa se llame igual en todos lados.
 */
export const OPCIONES_NUEVO: readonly OpcionNuevo[] = [
  { tipo: "nota", comando: "nota.nueva", titulo: "Nueva nota" },
  { tipo: "carpeta", comando: "crear.carpeta", titulo: "Nueva carpeta" },
  { tipo: "lienzo", comando: "crear.lienzo", titulo: "Nuevo canvas", detalle: "notas en el espacio" },
  { tipo: "tabla", comando: "crear.tabla", titulo: "Nueva base", detalle: "tabla de notas" },
  { tipo: "dibujo", comando: "crear.dibujo", titulo: "Nuevo dibujo Excalidraw" },
  {
    tipo: "diagrama",
    comando: "crear.diagrama",
    titulo: "Nuevo diagrama draw.io",
    detalle: "figuras y conectores",
  },
  { tipo: "espora", comando: "crear.desde-espora", titulo: "Nueva desde Espora…" },
];

/** La opción de un tipo. */
export const opcionDe = (tipo: OpcionNuevo["tipo"]): OpcionNuevo => OPCIONES_NUEVO.find((o) => o.tipo === tipo)!;

/** «Nueva base (tabla de notas)»: el título con su detalle, como en el explorador. */
export const tituloConDetalle = (o: OpcionNuevo) => (o.detalle ? `${o.titulo} (${o.detalle})` : o.titulo);

// ── el menú «Nuevo…» con el teclado ────────────────────────────────────────

/** En qué paso está el menú y qué opción está marcada. */
export type EstadoNuevo = { paso: "tipos" | "esporas"; activa: number };

export const ESTADO_INICIAL_NUEVO: EstadoNuevo = { paso: "tipos", activa: 0 };

/** Lo que pide una tecla. */
export type ResultadoTeclaNuevo =
  | { accion: "nada" }
  | { accion: "mover"; estado: EstadoNuevo }
  | { accion: "elegir"; indice: number }
  | { accion: "volver" }
  | { accion: "cerrar" };

/**
 * Qué hace una tecla en el menú «Nuevo…». `cantidad` es cuántas opciones hay
 * en el paso actual; `abreSubmenu`, si la opción marcada lleva a otro paso
 * (las Esporas).
 *
 * - ↑/↓ recorren con vuelta; Inicio/Fin van a la primera y la última.
 * - Enter elige. → elige solo si la opción abre un segundo paso.
 * - En las Esporas, ← y Retroceso vuelven a los tipos; Esc también vuelve.
 * - En los tipos, Esc cierra.
 */
export function teclaEnNuevo(
  estado: EstadoNuevo,
  key: string,
  cantidad: number,
  abreSubmenu = false,
): ResultadoTeclaNuevo {
  const mover = (activa: number): ResultadoTeclaNuevo => ({ accion: "mover", estado: { ...estado, activa } });
  switch (key) {
    case "ArrowDown":
      return cantidad ? mover((estado.activa + 1) % cantidad) : { accion: "nada" };
    case "ArrowUp":
      return cantidad ? mover((estado.activa - 1 + cantidad) % cantidad) : { accion: "nada" };
    case "Home":
      return cantidad ? mover(0) : { accion: "nada" };
    case "End":
      return cantidad ? mover(cantidad - 1) : { accion: "nada" };
    case "Enter":
      return cantidad ? { accion: "elegir", indice: estado.activa } : { accion: "nada" };
    case "ArrowRight":
      return estado.paso === "tipos" && abreSubmenu ? { accion: "elegir", indice: estado.activa } : { accion: "nada" };
    case "ArrowLeft":
    case "Backspace":
      return estado.paso === "esporas" ? { accion: "volver" } : { accion: "nada" };
    case "Escape":
      return estado.paso === "esporas" ? { accion: "volver" } : { accion: "cerrar" };
    default:
      return { accion: "nada" };
  }
}
