/**
 * Fórmulas KaTeX en la edición en vivo (`DEF-103`).
 *
 * La vista de lectura las dibuja con `remark-math` + `rehype-katex` desde
 * `lib/markdown.ts`; la edición en vivo **no comparte ese camino** y las dejaba
 * crudas, con los `$` a la vista. Este módulo es la otra mitad, y reconoce lo
 * mismo que reconoce `remark-math`, para que una fórmula no se vea en una vista
 * y en la otra no:
 *
 * - **En línea**: `$…$` (y `$$…$$` dentro de un renglón), con la regla de
 *   `remark-math`, que es la del código en línea: una tanda de N signos `$`
 *   abre y cierra con otra de exactamente N. Siempre en modo en línea: así lo
 *   dibuja también la lectura.
 * - **En bloque**: un renglón que empieza con `$$` —con hasta tres espacios
 *   delante— abre, y otro con solo `$$` (o más) cierra. Modo display.
 *
 * Lo que está dentro de código —en línea o en bloque— no es una fórmula.
 */
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  RangeSetBuilder,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import katex from "katex";

// ── En línea ────────────────────────────────────────────────────────────────

export type FormulaEnLinea = {
  /** Posición del primer `$`, relativa al texto recibido. */
  desde: number;
  /** Posición siguiente al último `$`. */
  hasta: number;
  tex: string;
};

/**
 * Las fórmulas en línea de un renglón. `enCodigo(i)` dice si la posición `i`
 * del renglón cae dentro de código, donde un `$` es solo un `$`.
 */
export function formulasEnLinea(
  texto: string,
  enCodigo: (i: number) => boolean = () => false,
): FormulaEnLinea[] {
  const halladas: FormulaEnLinea[] = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "\\") {
      i += 2; // `\$` es un signo de pesos literal
      continue;
    }
    if (c !== "$") {
      i++;
      continue;
    }
    let n = 0;
    while (texto[i + n] === "$") n++;
    if (enCodigo(i)) {
      i += n;
      continue;
    }
    // Buscar una tanda de EXACTAMENTE n signos que cierre.
    let j = i + n;
    let cierre = -1;
    while (j < texto.length) {
      if (texto[j] !== "$") {
        j++;
        continue;
      }
      let m = 0;
      while (texto[j + m] === "$") m++;
      if (m === n) {
        cierre = j;
        break;
      }
      j += m;
    }
    const tex = cierre > 0 ? texto.slice(i + n, cierre) : "";
    if (cierre < 0 || tex.trim() === "") {
      i += n;
      continue;
    }
    halladas.push({ desde: i, hasta: cierre + n, tex: tex.trim() });
    i = cierre + n;
  }
  return halladas;
}

// ── El dibujo ────────────────────────────────────────────────────────────────

/**
 * Una fórmula dibujada. Al hacer clic pone el cursor en su fuente para
 * editarla, como el resto de lo que se renderiza en vivo.
 */
export class FormulaWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: FormulaWidget) {
    return other.tex === this.tex && other.display === this.display && other.pos === this.pos;
  }

  toDOM(view: EditorView) {
    const caja = document.createElement(this.display ? "div" : "span");
    caja.className = this.display ? "mic-live-math mic-live-math-bloque" : "mic-live-math";
    // Con `throwOnError: false` una fórmula mal escrita sale en rojo con su
    // fuente, igual que en lectura, en vez de romper la línea.
    caja.innerHTML = katex.renderToString(this.tex, {
      displayMode: this.display,
      throwOnError: false,
    });
    caja.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos } });
      view.focus();
    });
    return caja;
  }

  ignoreEvent() {
    return true; // el clic lo atiende el listener de arriba
  }
}

// ── En bloque ────────────────────────────────────────────────────────────────

const APERTURA_RE = /^ {0,3}(\${2,})([^$]*)$/;
const CIERRE_RE = /^ {0,3}(\${2,})\s*$/;

type BloqueFormula = { desde: number; hasta: number; tex: string };

/** ¿La posición cae dentro de un bloque de código cercado o indentado? */
function enBloqueDeCodigo(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
}

/**
 * Los bloques `$$ … $$` cerrados del documento. Uno sin cierre no se dibuja.
 * `hayApertura` dice si algún renglón PODRÍA abrir uno (aunque esté en código o
 * no cierre): si no hay ninguno, no hay bloques, y el campo lo aprovecha.
 */
function bloquesDeFormula(state: EditorState): { bloques: BloqueFormula[]; hayApertura: boolean } {
  const doc = state.doc;
  const bloques: BloqueFormula[] = [];
  let hayApertura = false;
  for (let n = 1; n <= doc.lines; n++) {
    const apertura = doc.line(n);
    const m = APERTURA_RE.exec(apertura.text);
    if (!m) continue;
    hayApertura = true;
    if (enBloqueDeCodigo(state, apertura.from)) continue;
    for (let k = n + 1; k <= doc.lines; k++) {
      const linea = doc.line(k);
      const c = CIERRE_RE.exec(linea.text);
      if (c && c[1].length >= m[1].length) {
        const cuerpo: string[] = [];
        for (let q = n + 1; q < k; q++) cuerpo.push(doc.line(q).text);
        bloques.push({ desde: apertura.from, hasta: linea.to, tex: cuerpo.join("\n") });
        n = k;
        break;
      }
    }
  }
  return { bloques, hayApertura };
}

/** ¿Algún renglón tocado por la transacción podría abrir un bloque? */
function aperturaEnCambios(tr: Transaction): boolean {
  const doc = tr.state.doc;
  let hay = false;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (hay) return;
    const ultima = doc.lineAt(toB).number;
    for (let n = doc.lineAt(fromB).number; n <= ultima; n++) {
      if (APERTURA_RE.test(doc.line(n).text)) {
        hay = true;
        return;
      }
    }
  });
  return hay;
}

export type EstadoFormulas = {
  decorations: DecorationSet;
  /** Bloques dibujados: el resto del live preview no los decora. */
  ranges: [number, number][];
  /** Todos los bloques, dibujados o no: dentro de ellos no hay fórmulas en línea. */
  todos: [number, number][];
  /** Los bloques hallados, para no volver a buscarlos si solo se movió el cursor. */
  bloques: BloqueFormula[];
  /** ¿Algún renglón podría abrir un bloque? Ver `bloquesDeFormula`. */
  hayApertura: boolean;
};

/** Las decoraciones de `bloques` según dónde está el cursor ahora. */
function decorarBloques(
  state: EditorState,
  bloques: BloqueFormula[],
  hayApertura: boolean,
): EstadoFormulas {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: [number, number][] = [];
  const todos: [number, number][] = [];
  for (const b of bloques) {
    todos.push([b.desde, b.hasta]);
    // Con el cursor (o la selección) tocándolo se ve la fuente, para editarla.
    const tocado = state.selection.ranges.some((r) => r.to >= b.desde && r.from <= b.hasta);
    if (tocado || b.tex.trim() === "") continue;
    builder.add(
      b.desde,
      b.hasta,
      Decoration.replace({ widget: new FormulaWidget(b.tex, true, b.desde), block: true }),
    );
    ranges.push([b.desde, b.hasta]);
  }
  return { decorations: builder.finish(), ranges, todos, bloques, hayApertura };
}

function calcularBloques(state: EditorState): EstadoFormulas {
  const { bloques, hayApertura } = bloquesDeFormula(state);
  return decorarBloques(state, bloques, hayApertura);
}

/**
 * Tras un movimiento del cursor: los mismos bloques, decorados según dónde
 * quedó. Si el cursor no entró ni salió de ninguno, el valor de antes, para que
 * CodeMirror no tenga decoraciones nuevas que comparar.
 */
function reDecorar(antes: EstadoFormulas, state: EditorState): EstadoFormulas {
  const ahora = decorarBloques(state, antes.bloques, antes.hayApertura);
  const iguales =
    ahora.ranges.length === antes.ranges.length &&
    ahora.ranges.every((r, i) => r[0] === antes.ranges[i][0] && r[1] === antes.ranges[i][1]);
  return iguales ? antes : ahora;
}

/**
 * Las fórmulas en bloque son decoraciones de BLOQUE que cruzan renglones, así
 * que tienen que venir de un `StateField`: un `ViewPlugin` no puede darlas.
 *
 * Buscar los bloques recorre el documento entero con una regex por renglón
 * (`FUN-M-58`, A-H4: 4,1 ms por tecla en una nota de 443 KB, 1,2 ms en una de
 * 135 KB; sin el campo, 0,015 ms). Por eso:
 * - Si ningún renglón podía abrir un bloque —casi todas las notas—, una tecla
 *   solo mira los renglones que tocó: así se nota el primer `$$` recién
 *   escrito. Y el árbol de sintaxis no importa: sin aperturas no hay bloques,
 *   estén o no en código.
 * - Si el documento no cambió (se movió el cursor), los bloques son los mismos:
 *   solo se vuelve a ver cuáles toca el cursor.
 */
export const formulasField = StateField.define<EstadoFormulas>({
  create: calcularBloques,
  update(value, tr: Transaction) {
    if (!value.hayApertura) {
      // Sin aperturas, un cambio que no escribe una deja todo igual. (Borrar
      // la última apertura entra por la rama de abajo, que recalcula todo y
      // deja `hayApertura` en falso.)
      if (tr.docChanged && aperturaEnCambios(tr)) return calcularBloques(tr.state);
      return value;
    }
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return calcularBloques(tr.state);
    }
    if (tr.selection) return reDecorar(value, tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});
