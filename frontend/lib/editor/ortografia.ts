/**
 * Corrector ortográfico del editor (`FUN-L-12`).
 *
 * **Usa el corrector del sistema**, no uno propio: el de WebView2 en desktop y
 * el del navegador en web. Subraya, sugiere en el clic derecho nativo y ofrece
 * «Agregar al diccionario», que guarda en el diccionario del sistema. El idioma
 * es el del sistema operativo: WebView2 no deja elegirlo desde la app. Lo
 * decidió el usuario el 2026-09-27, al ver que un motor propio —diccionarios,
 * licencias, sugerencias, idiomas elegibles— era mucho más trabajo para lo que
 * se ganaba. Ver `docs/features/corrector-ortografico.md`.
 *
 * Lo que hace Mycelium son dos cosas:
 *
 *   1. **Encenderlo**: CodeMirror pone \`spellcheck="false"\` en su área editable
 *      por defecto, y por eso no había subrayados. Acá se pisa según la
 *      preferencia, que se consulta en cada actualización de la vista.
 *   2. **Excluir lo que no es texto**: el código, las URLs, los \`[[enlaces]]\`,
 *      las etiquetas, las fórmulas y el frontmatter se marcan con
 *      \`spellcheck="false"\`. Sin esto, un bloque de código o un nombre de nota
 *      se llenaría de subrayados.
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { getAllViews } from "@/lib/editor/viewRegistry";
import { formulasEnLinea } from "@/lib/editor/matematicas";

/** Marca un tramo como «no corregir». */
const noCorregir = Decoration.mark({ attributes: { spellcheck: "false" } });
/** Lo mismo para un renglón entero (bloques de código, frontmatter). */
const lineaSinCorregir = Decoration.line({ attributes: { spellcheck: "false" } });

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
/** Abre un bloque `$$` (sin cerrarlo en el mismo renglón), como en `matematicas.ts`. */
const APERTURA_FORMULA_RE = /^ {0,3}\${2,}[^$]*$/;
/** Cierra un bloque `$$`. */
const CIERRE_FORMULA_RE = /^ {0,3}\${2,}\s*$/;
/** Hasta cuántos renglones se busca el cierre del frontmatter. */
const MAX_FRONTMATTER = 400;

/** Los renglones del frontmatter (del `---` inicial al que lo cierra), o 0. */
function renglonesFrontmatter(view: EditorView): number {
  const doc = view.state.doc;
  if (doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, MAX_FRONTMATTER); n++) {
    const t = doc.line(n).text.trim();
    if (t === "---" || t === "...") return n;
  }
  return 0;
}

type Tramo = { desde: number; hasta: number; linea: boolean };

function exclusiones(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const tramos: Tramo[] = [];

  // El frontmatter: son claves y valores, no prosa. En vivo casi siempre está
  // reemplazado por la tarjeta de propiedades, pero en crudo se ve.
  const frontmatter = renglonesFrontmatter(view);
  for (let n = 1; n <= frontmatter; n++) {
    tramos.push({ desde: doc.line(n).from, hasta: doc.line(n).from, linea: true });
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(nodo) {
        if (BLOQUES_SIN_CORREGIR.has(nodo.name)) {
          const primera = doc.lineAt(nodo.from).number;
          const ultima = doc.lineAt(nodo.to).number;
          for (let n = primera; n <= ultima; n++) {
            const l = doc.line(n);
            tramos.push({ desde: l.from, hasta: l.from, linea: true });
          }
          return false;
        }
        if (NODOS_SIN_CORREGIR.has(nodo.name) && nodo.from < nodo.to) {
          tramos.push({ desde: nodo.from, hasta: nodo.to, linea: false });
          return false;
        }
        return undefined;
      },
    });

    // Lo que se reconoce por renglón: enlaces, etiquetas y fórmulas. Un bloque
    // `$$` —el cerco y todo lo que encierra— es LaTeX, no prosa. (Si el bloque
    // empezó antes de lo visible, no se sabe: queda corregible hasta su cierre.)
    let dentroDeFormula = false;
    for (let pos = from; pos <= to; ) {
      const linea = doc.lineAt(pos);
      const texto = linea.text;
      if (!dentroDeFormula && APERTURA_FORMULA_RE.test(texto)) {
        tramos.push({ desde: linea.from, hasta: linea.from, linea: true });
        dentroDeFormula = true;
      } else if (dentroDeFormula) {
        tramos.push({ desde: linea.from, hasta: linea.from, linea: true });
        if (CIERRE_FORMULA_RE.test(texto)) dentroDeFormula = false;
      } else {
        for (const m of texto.matchAll(WIKILINK_RE)) {
          tramos.push({ desde: linea.from + m.index, hasta: linea.from + m.index + m[0].length, linea: false });
        }
        for (const m of texto.matchAll(TAG_RE)) {
          const inicio = linea.from + m.index + m[1].length;
          tramos.push({ desde: inicio, hasta: inicio + m[2].length, linea: false });
        }
        for (const f of formulasEnLinea(texto)) {
          tramos.push({ desde: linea.from + f.desde, hasta: linea.from + f.hasta, linea: false });
        }
      }
      if (linea.to >= to) break;
      pos = linea.to + 1;
    }
  }

  // RangeSetBuilder exige orden: por posición, y las de renglón (vacías)
  // antes que las marcas que empiezan en el mismo lugar.
  tramos.sort((a, b) => a.desde - b.desde || Number(b.linea) - Number(a.linea) || a.hasta - b.hasta);
  const builder = new RangeSetBuilder<Decoration>();
  let ultimaLinea = -1;
  for (const t of tramos) {
    if (t.linea) {
      if (t.desde === ultimaLinea) continue; // el mismo renglón, dos veces
      ultimaLinea = t.desde;
      builder.add(t.desde, t.desde, lineaSinCorregir);
    } else if (t.desde < t.hasta) {
      builder.add(t.desde, t.hasta, noCorregir);
    }
  }
  return builder.finish();
}

const exclusionesPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = exclusiones(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = exclusiones(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * El corrector, encendido o apagado según `activo()`, que se lee en cada
 * actualización de la vista. Al cambiar la preferencia hay que llamar a
 * `refrescarCorrector()` para que las vistas abiertas se enteren sin esperar a
 * que el usuario escriba.
 */
export function correctorOrtografico(activo: () => boolean): Extension {
  return [
    EditorView.contentAttributes.of(() => ({ spellcheck: activo() ? "true" : "false" })),
    exclusionesPlugin,
  ];
}

/** Aplica ya un cambio de la preferencia a todos los editores abiertos. */
export function refrescarCorrector(): void {
  for (const view of getAllViews()) view.dispatch({});
}
