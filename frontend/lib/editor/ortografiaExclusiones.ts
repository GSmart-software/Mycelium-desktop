/**
 * Lo que el corrector ortográfico **no** revisa (`FUN-L-12`): código, URLs,
 * HTML, `[[enlaces]]`, etiquetas, fórmulas, callouts y frontmatter.
 *
 * Hasta el motor propio esto se pintaba como `spellcheck="false"` sobre cada
 * tramo, para que el corrector del sistema lo saltara. Ahora es una función que
 * devuelve **intervalos**: el `ViewPlugin` de `ortografia.ts` descarta las
 * palabras que caen en ellos antes de preguntarle nada al worker. Está aparte
 * —solo depende del árbol de sintaxis y de `matematicas.ts`— para poder
 * probarla con un `EditorState` real sin montar una vista
 * (`scripts/test-ortografia.mjs`).
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { formulasEnLinea } from "@/lib/editor/matematicas";
import type { Intervalo } from "@/lib/ortografia/palabras";

/** Nodos del árbol de markdown que no son prosa. */
const NODOS_SIN_CORREGIR = new Set([
  "InlineCode",
  "URL",
  "Autolink",
  "HTMLTag",
  "HTMLBlock",
  "CommentBlock",
  "Comment",
]);
/** Bloques que se excluyen renglón por renglón. */
const BLOQUES_SIN_CORREGIR = new Set(["FencedCode", "CodeBlock", "HTMLBlock"]);

const WIKILINK_RE = /!?\[\[[^[\]]*\]\]/g;
const TAG_RE = /(^|[\s(])(#[\p{L}\p{N}_/-]+)/gu;
/**
 * URLs y correos sueltos en la prosa. El árbol ya marca los `<https://…>` y los
 * de un `[texto](url)`, pero una URL pegada sin más es texto plano para él.
 */
const URL_SUELTA_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
/** El tipo de un callout: `> [!warning]`, `> [!tip]-`. Es sintaxis, no prosa. */
const CALLOUT_RE = /^(?:\s*>)+\s*\[![^\]\s]*\][+-]?/;
/** Abre un bloque `$$` (sin cerrarlo en el mismo renglón), como en `matematicas.ts`. */
const APERTURA_FORMULA_RE = /^ {0,3}\${2,}[^$]*$/;
/** Cierra un bloque `$$`. */
const CIERRE_FORMULA_RE = /^ {0,3}\${2,}\s*$/;
/** Hasta cuántos renglones se busca el cierre del frontmatter. */
const MAX_FRONTMATTER = 400;

/** Los renglones del frontmatter (del `---` inicial al que lo cierra), o 0. */
function renglonesFrontmatter(state: EditorState): number {
  const doc = state.doc;
  if (doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, MAX_FRONTMATTER); n++) {
    const t = doc.line(n).text.trim();
    if (t === "---" || t === "...") return n;
  }
  return 0;
}

/**
 * Los intervalos del documento que no se corrigen, dentro de `rangos` (lo
 * visible, con su margen). Pueden superponerse y no vienen ordenados:
 * `fueraDeExcluidos` se encarga.
 */
export function rangosExcluidos(
  state: EditorState,
  rangos: readonly { from: number; to: number }[],
): Intervalo[] {
  const doc = state.doc;
  const tramos: Intervalo[] = [];
  const renglon = (n: number) => {
    const l = doc.line(n);
    tramos.push({ desde: l.from, hasta: l.to });
  };

  // El frontmatter: son claves y valores, no prosa. En vivo casi siempre está
  // reemplazado por la tarjeta de propiedades, pero en crudo se ve.
  const frontmatter = renglonesFrontmatter(state);
  if (frontmatter > 0) tramos.push({ desde: 0, hasta: doc.line(frontmatter).to });

  const arbol = syntaxTree(state);
  for (const { from, to } of rangos) {
    arbol.iterate({
      from,
      to,
      enter(nodo) {
        if (BLOQUES_SIN_CORREGIR.has(nodo.name)) {
          tramos.push({ desde: nodo.from, hasta: nodo.to });
          return false;
        }
        if (NODOS_SIN_CORREGIR.has(nodo.name) && nodo.from < nodo.to) {
          tramos.push({ desde: nodo.from, hasta: nodo.to });
          return false;
        }
        return undefined;
      },
    });

    // Lo que se reconoce por renglón: enlaces, etiquetas, URLs sueltas,
    // callouts y fórmulas. Un bloque `$$` —el cerco y todo lo que encierra— es
    // LaTeX, no prosa. (Si el bloque empezó antes del rango, no se sabe: queda
    // corregible hasta su cierre. El margen alrededor de lo visible lo hace raro.)
    let dentroDeFormula = false;
    for (let pos = from; pos <= to; ) {
      const linea = doc.lineAt(pos);
      const texto = linea.text;
      if (!dentroDeFormula && APERTURA_FORMULA_RE.test(texto)) {
        renglon(linea.number);
        dentroDeFormula = true;
      } else if (dentroDeFormula) {
        renglon(linea.number);
        if (CIERRE_FORMULA_RE.test(texto)) dentroDeFormula = false;
      } else {
        for (const m of texto.matchAll(WIKILINK_RE)) {
          tramos.push({ desde: linea.from + m.index, hasta: linea.from + m.index + m[0].length });
        }
        for (const m of texto.matchAll(TAG_RE)) {
          const inicio = linea.from + m.index + m[1].length;
          tramos.push({ desde: inicio, hasta: inicio + m[2].length });
        }
        for (const m of texto.matchAll(URL_SUELTA_RE)) {
          tramos.push({ desde: linea.from + m.index, hasta: linea.from + m.index + m[0].length });
        }
        const callout = CALLOUT_RE.exec(texto);
        if (callout) tramos.push({ desde: linea.from, hasta: linea.from + callout[0].length });
        for (const f of formulasEnLinea(texto)) {
          tramos.push({ desde: linea.from + f.desde, hasta: linea.from + f.hasta });
        }
      }
      if (linea.to >= to) break;
      pos = linea.to + 1;
    }
  }
  return tramos;
}
