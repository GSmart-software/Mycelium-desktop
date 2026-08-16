import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  type EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { renderMarkdown } from "@/lib/markdown";
import {
  ponerPropiedad,
  quitarPropiedad,
  renombrarPropiedad,
  separarFrontmatter,
} from "@/lib/frontmatter";
import { aplicarEdicionFrontmatter } from "@/lib/editor/commands";
import {
  TarjetaPropiedades,
  controlPropiedadesDe,
  esControlDePropiedades,
  type AccionesPropiedades,
} from "@/lib/editor/propiedadesWidget";
import { renderExcalidrawInto } from "@/lib/excalidraw";
import { getAllViews } from "@/lib/editor/viewRegistry";
import { useUiStore } from "@/stores/uiStore";

/** Estilos inline del live preview (HU-01 CA6/CA7). */
const micelioHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
    color: "var(--mic-text-muted)",
  },
  {
    tag: tags.monospace,
    fontFamily: "var(--mic-font-mono)",
    background: "var(--mic-bg-code)",
    color: "var(--mic-text-primary)",
    borderRadius: "var(--mic-radius-sm)",
    padding: "0.05em 0.2em",
  },
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.quote, color: "var(--mic-text-muted)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--mic-accent)" },
  // Tokens de código embebido en bloques cercados (HU-03), con la misma
  // paleta de sintaxis del editor de CSS (--mic-syntax-*).
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--mic-syntax-comment)",
    fontStyle: "italic",
  },
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword], color: "var(--mic-syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--mic-syntax-string)" },
  { tag: [tags.number, tags.bool, tags.atom], color: "var(--mic-syntax-number)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--mic-syntax-keyword)" },
  { tag: [tags.variableName, tags.propertyName], color: "var(--mic-syntax-variable)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--mic-syntax-tag)" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--mic-text-muted)" },
]);

/** Efecto para forzar recálculo del live preview (p. ej. al togglear tablas). */
export const refreshLiveEffect = StateEffect.define<null>();

// Generación de los embeds excalidraw en vivo: aumenta en cada refresh para que
// los widgets se vuelvan a renderizar (su eq() la incluye) tras guardar un dibujo.
let liveGen = 0;

/** Redispara el live preview en todos los editores abiertos. */
export function refreshAllLiveViews() {
  liveGen++;
  for (const view of getAllViews()) {
    view.dispatch({ effects: refreshLiveEffect.of(null) });
  }
}

/** Widget de bloque que renderiza una tabla markdown como HTML (HU-01). */
class TableWidget extends WidgetType {
  constructor(readonly md: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.md === this.md;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "mic-preview mic-live-table";
    wrap.innerHTML = renderMarkdown(this.md);
    return wrap;
  }
  /**
   * Altura estimada del widget para el height-map de CodeMirror. Es CLAVE: sin
   * ella (por defecto -1 = desconocida) CM estima mal la altura de las tablas
   * FUERA de pantalla, y el height-map (que posiciona el gutter y el scroll del
   * buscador) diverge del contenido real medido, acumulando desfase cuanto más
   * contenido hay. Estimación: nº de filas (líneas con `|`) × alto de fila
   * (~36px: fuente 0.875rem·1.7 + padding + borde) + márgenes de tabla/widget.
   */
  get estimatedHeight() {
    const filas = this.md.split("\n").filter((l) => l.includes("|")).length;
    return Math.max(1, filas) * 36 + 26;
  }
  ignoreEvent() {
    return false;
  }
}

type TableState = { decorations: DecorationSet; ranges: [number, number][] };

/**
 * Calcula las tablas a renderizar como bloque. Las decoraciones de bloque DEBEN
 * venir de un StateField (un ViewPlugin rompe el layout de CodeMirror).
 */
function computeTables(state: EditorState): TableState {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: [number, number][] = [];
  if (!useUiStore.getState().liveTables) return { decorations: builder.finish(), ranges };

  const doc = state.doc;
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) active.add(l);
  }

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return undefined;
      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      for (let l = startLine.number; l <= endLine.number; l++) {
        if (active.has(l)) return false; // cursor dentro → editar en crudo
      }
      const md = doc.sliceString(startLine.from, endLine.to);
      builder.add(
        startLine.from,
        endLine.to,
        Decoration.replace({ widget: new TableWidget(md), block: true }),
      );
      ranges.push([startLine.from, endLine.to]);
      return false;
    },
  });
  return { decorations: builder.finish(), ranges };
}

/** Tablas renderizadas (decoraciones de bloque) — vía StateField. */
const tableField = StateField.define<TableState>({
  create: (state) => computeTables(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshLiveEffect))
    ) {
      return computeTables(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/**
 * Pide ver el bloque de propiedades como texto (`true`) o volver a la tarjeta
 * (`false`). Es el «editar como texto» de `FUN-M-19`: dura hasta que el cursor
 * sale del bloque.
 */
const crudoFrontmatterEffect = StateEffect.define<boolean>();

/**
 * Widget de bloque que reemplaza el frontmatter YAML por la tarjeta de
 * propiedades (`FUN-M-04`), **editable en sitio** desde `FUN-M-19`: cambiar un
 * valor, renombrar una clave, agregar y quitar propiedades sin abrir el YAML.
 *
 * Lo que sostiene que un widget interactivo no reviva `DEF-031`/`DEF-037` está
 * repartido entre esta clase y `propiedadesWidget.ts`: `updateDOM()` parchea en
 * sitio (nunca se reconstruye mientras se escribe), `ignoreEvent()` devuelve
 * `true` para los controles, el espaciado es `padding` y `estimatedHeight` se
 * recalcula con las filas. Ver `docs/features/edicion-en-el-render.md` § 2.
 */
class FrontmatterWidget extends WidgetType {
  /** Filas de la tarjeta, para estimar el alto del bloque (ver abajo). */
  private readonly filas: number;

  constructor(readonly texto: string) {
    super();
    const fm = separarFrontmatter(texto);
    this.filas = !fm.hay
      ? 0
      : fm.soportado
        ? fm.props.length
        : fm.crudo.split("\n").length + 1;
  }

  eq(other: FrontmatterWidget) {
    return other.texto === this.texto;
  }

  toDOM(view: EditorView) {
    const tarjeta = new TarjetaPropiedades(accionesPropiedades(view));
    tarjeta.sincronizar(this.texto);
    return tarjeta.dom;
  }

  /**
   * OBLIGATORIO: sin esto CodeMirror tiraría el DOM y lo volvería a construir en
   * cada pulsación, y el campo que se está editando perdería el foco a la
   * primera tecla. Devuelve `false` solo si el DOM no es de esta tarjeta (no
   * debería pasar) para que CodeMirror lo rehaga.
   */
  updateDOM(dom: HTMLElement) {
    const tarjeta = controlPropiedadesDe(dom);
    if (!tarjeta) return false;
    tarjeta.sincronizar(this.texto);
    return true;
  }

  /**
   * Altura estimada del bloque. OBLIGATORIA: sin ella CodeMirror estima mal la
   * altura del widget fuera de pantalla y su height-map diverge del layout real,
   * que es exactamente la causa raíz de `DEF-031`/`DEF-037` (gutter corrido,
   * clic que selecciona de más, scroll del buscador roto). Estimación: una fila
   * por propiedad (~30px) + el pie de «agregar propiedad» y los padding. Se
   * recalcula sola al cambiar el nº de filas porque el widget se reconstruye en
   * cada cambio del documento (lo que se conserva es su DOM, no la instancia).
   */
  get estimatedHeight() {
    return Math.max(1, this.filas) * 30 + 64;
  }

  /**
   * Invertido respecto de `FUN-M-04`: lo que nace en un control es NUESTRO (si
   * CodeMirror se quedara el evento, el campo no recibiría ni el clic ni las
   * teclas). El resto de la tarjeta sigue siendo del editor, que coloca el
   * cursor como con cualquier otro bloque.
   */
  ignoreEvent(event: Event) {
    return esControlDePropiedades(event.target);
  }
}

/** Las operaciones de la tarjeta, atadas a la vista que la dibuja. */
function accionesPropiedades(view: EditorView): AccionesPropiedades {
  const editar = (transformar: (texto: string) => string) =>
    aplicarEdicionFrontmatter(view, transformar);
  return {
    poner: (clave, valor, tipo) => editar((t) => ponerPropiedad(t, clave, valor, tipo)),
    quitar: (clave) => editar((t) => quitarPropiedad(t, clave)),
    renombrar: (clave, nueva) => editar((t) => renombrarPropiedad(t, clave, nueva)),
    verComoTexto: () => {
      const lim = limitesFrontmatter(view.state);
      view.dispatch({
        effects: crudoFrontmatterEffect.of(true),
        // El cursor entra al bloque: es lo que mantiene el crudo abierto (y lo
        // que cierra al salir). En un bloque vacío no hay línea de contenido,
        // así que va al final del `---` de apertura.
        selection: { anchor: lim ? lim.primeraLinea : 0 },
        scrollIntoView: true,
      });
      view.focus();
    },
    // Abrir el editor de un valor cambia el alto del bloque FUERA del ciclo de
    // actualización de CodeMirror: sin esto su height-map se quedaría con el
    // alto anterior, que es el desfase de `DEF-031`/`DEF-037`.
    medir: () => view.requestMeasure(),
  };
}

type FrontmatterState = {
  decorations: DecorationSet;
  ranges: [number, number][];
  /** ¿Se está mostrando el bloque como texto («editar como texto»)? */
  crudo: boolean;
};

const SIN_FRONTMATTER: FrontmatterState = {
  decorations: Decoration.none,
  ranges: [],
  crudo: false,
};

type LimitesFrontmatter = {
  desde: number;
  hasta: number;
  /** Posición donde dejar el cursor al abrir el bloque como texto. */
  primeraLinea: number;
};

/**
 * Límites del bloque de frontmatter en el documento, o null si no hay.
 *
 * Mismas reglas de detección que `separarFrontmatter`, pero sobre las líneas del
 * documento: así no hay que serializar la nota entera en cada pulsación.
 */
function limitesFrontmatter(state: EditorState): LimitesFrontmatter | null {
  const doc = state.doc;
  if (doc.lines < 2 || sinCr(doc.line(1).text) !== "---") return null;
  let cierre = 0;
  // El tope acota el coste en el caso patológico: una nota que EMPIEZA con una
  // regla horizontal `---` y no cierra nunca haría recorrer el documento entero
  // en cada pulsación. Un frontmatter más largo que esto no es realista.
  const tope = Math.min(doc.lines, 500);
  for (let n = 2; n <= tope; n++) {
    const t = sinCr(doc.line(n).text);
    if (t === "---" || t === "...") {
      cierre = n;
      break;
    }
  }
  if (cierre === 0) return null;
  return {
    desde: doc.line(1).from,
    hasta: doc.line(cierre).to,
    primeraLinea: cierre > 2 ? doc.line(2).from : doc.line(1).to,
  };
}

/**
 * Calcula el bloque de frontmatter a renderizar. Igual que las tablas, es una
 * decoración de BLOQUE y por eso vive en un StateField (un ViewPlugin rompe el
 * layout de CodeMirror).
 *
 * El rango se devuelve SIEMPRE, se dibuje la tarjeta o no: aunque se esté viendo
 * el YAML crudo, el resto del live preview debe ignorar esas líneas (el `---` no
 * es una regla horizontal, y los `#` del YAML no son etiquetas).
 *
 * A diferencia de `FUN-M-04`, el cursor dentro del bloque ya NO lo abre en
 * crudo: se edita renderizado (`FUN-M-19`). La fuente se ve solo a pedido, con
 * «editar como texto».
 */
function computeFrontmatter(state: EditorState, crudo: boolean): FrontmatterState {
  const lim = limitesFrontmatter(state);
  if (!lim) return SIN_FRONTMATTER;

  const ranges: [number, number][] = [[lim.desde, lim.hasta]];
  if (crudo) return { decorations: Decoration.none, ranges, crudo };

  const builder = new RangeSetBuilder<Decoration>();
  builder.add(
    lim.desde,
    lim.hasta,
    Decoration.replace({
      widget: new FrontmatterWidget(state.doc.sliceString(lim.desde, lim.hasta)),
      block: true,
    }),
  );
  return { decorations: builder.finish(), ranges, crudo };
}

const sinCr = (linea: string): string => (linea.endsWith("\r") ? linea.slice(0, -1) : linea);

/** Frontmatter renderizado como tarjeta (decoración de bloque) — vía StateField. */
const frontmatterField = StateField.define<FrontmatterState>({
  create: (state) => computeFrontmatter(state, false),
  update(value, tr) {
    let crudo = value.crudo;
    for (const e of tr.effects) if (e.is(crudoFrontmatterEffect)) crudo = e.value;
    if (crudo && tr.selection) {
      // El crudo dura mientras el cursor siga dentro del bloque (spec § 3.4).
      const lim = limitesFrontmatter(tr.state);
      if (!lim || tr.state.selection.ranges.every((r) => r.from > lim.hasta)) crudo = false;
    }
    if (
      crudo !== value.crudo ||
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshLiveEffect))
    ) {
      return computeFrontmatter(tr.state, crudo);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/** Extensiones del modo `live`: highlight + bloques + decoraciones inline. */
export function liveExtensions(
  onWikilinkClick: (title: string) => void,
  noteExists: (target: string) => boolean,
  notaId: string | null = null,
): Extension {
  return [
    syntaxHighlighting(micelioHighlight),
    frontmatterField,
    // El bloque de propiedades ya NO se abre en crudo con el cursor dentro
    // (`FUN-M-19`), así que el cursor no puede quedarse DENTRO del YAML
    // invisible: se lo declara átomo y el clic y las flechas caen en sus bordes
    // en vez de escribir a ciegas dentro del frontmatter. Mientras se lo edita
    // como texto no hay decoración, así que tampoco hay átomo.
    EditorView.atomicRanges.of(
      (view) => view.state.field(frontmatterField, false)?.decorations ?? Decoration.none,
    ),
    tableField,
    livePreview(onWikilinkClick, noteExists, notaId),
  ];
}

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;
/** Embed de un diagrama/archivo excalidraw: `![[ref.excalidraw]]`. */
const EXCALIDRAW_RE = /!\[\[([^[\]]+)\.excalidraw\]\]/g;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
/** Cabecera de callout: `> [!tipo]` (con `>` anidados para callouts dentro de
 *  callouts, DEF-022) y símbolo de plegado opcional (-/+). Grupo 1 = marcadores
 *  `>` (su nº = profundidad), 2 = tipo, 3 = símbolo. */
const CALLOUT_HEAD_RE = /^((?:\s*>\s*)+)\[!([\w-]+)\]([-+]?)/;

/** Etiquetas por tipo, usadas como título cuando el callout no tiene uno. */
const CALLOUT_LABELS: Record<string, string> = {
  note: "Nota",
  tip: "Consejo",
  important: "Importante",
  warning: "Advertencia",
  caution: "Precaución",
  info: "Información",
  success: "Éxito",
  error: "Error",
  danger: "Peligro",
  question: "Pregunta",
};

const hide = Decoration.replace({});

/** Regla horizontal (--- *** ___): se dibuja como separador fuera de la línea activa. */
class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "mic-live-hr";
    return hr;
  }
  ignoreEvent() {
    return false;
  }
}

/** Checkbox visual (no interactivo) de lista de tareas en la edición en vivo. */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-live-check" + (this.checked ? " mic-live-check-on" : "");
    return span;
  }
}

/** Etiqueta del tipo que reemplaza al marcador cuando no hay título. */
class LabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: LabelWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-callout-label";
    span.textContent = this.label;
    return span;
  }
}

/** Chevron clickeable para plegar/desplegar el callout (alterna -/+ en el doc). */
class FoldWidget extends WidgetType {
  constructor(
    readonly headFrom: number,
    readonly collapsed: boolean,
  ) {
    super();
  }
  eq(other: FoldWidget) {
    return other.headFrom === this.headFrom && other.collapsed === this.collapsed;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "mic-callout-fold";
    span.dataset.head = String(this.headFrom);
    span.textContent = this.collapsed ? "▸" : "▾";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/** Alterna el símbolo de plegado (-/+) de la cabecera de un callout. */
function toggleCalloutFold(view: EditorView, headFrom: number) {
  const line = view.state.doc.lineAt(headFrom);
  const match = /^((?:\s*>\s*)+\[!\w+\])([-+])/.exec(line.text);
  if (!match) return;
  const pos = line.from + match[1].length;
  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: match[2] === "-" ? "+" : "-" },
  });
}

/**
 * Live preview por línea (HU-01): los marcadores markdown (#, **, ~~, `,
 * [[ ]]) se ocultan en todas las líneas excepto las que contienen el
 * cursor/selección — idéntico al Live Preview de Obsidian. El estilo del
 * texto (negrita, tamaño de heading, etc.) lo aplica syntaxHighlighting.
 */
export function livePreview(
  onWikilinkClick: (title: string) => void,
  noteExists: (target: string) => boolean,
  notaId: string | null = null,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, noteExists, notaId);
      }

      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshLiveEffect)),
        );
        if (update.docChanged || update.selectionSet || update.viewportChanged || refreshed) {
          this.decorations = buildDecorations(update.view, noteExists, notaId);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
      eventHandlers: {
        mousedown(event, view) {
          const fold = (event.target as HTMLElement).closest(".mic-callout-fold");
          if (fold) {
            event.preventDefault();
            toggleCalloutFold(view, Number(fold.getAttribute("data-head")));
            return true;
          }
          const link = (event.target as HTMLElement).closest(".mic-wikilink-cm");
          if (link) {
            event.preventDefault();
            onWikilinkClick(link.getAttribute("data-title") ?? "");
            return true;
          }
          return false;
        },
      },
    },
  );
}

/**
 * Widget de bloque que renderiza un embed de excalidraw (`![[ref.excalidraw]]`)
 * como el dibujo (SVG). Al hacer clic, coloca el cursor en la línea del embed
 * para que se muestre la fuente (se deja de renderizar), como el resto del live
 * preview. Solo aparece cuando el cursor NO está en esa línea.
 */
class ExcalidrawWidget extends WidgetType {
  constructor(
    readonly ref: string,
    readonly notaId: string | null,
    readonly pos: number,
    readonly gen: number,
  ) {
    super();
  }

  eq(other: ExcalidrawWidget) {
    return other.ref === this.ref && other.notaId === this.notaId && other.gen === this.gen;
  }

  toDOM(view: EditorView) {
    const block = document.createElement("div");
    block.className = "mic-live-excalidraw";
    block.addEventListener("mousedown", (event) => {
      // Clic → revelar la fuente: colocar el cursor en la línea del embed.
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos } });
      view.focus();
    });
    void renderExcalidrawInto(block, this.ref, this.notaId);
    return block;
  }

  ignoreEvent() {
    return true; // dejamos que nuestro propio listener de mousedown gestione el clic
  }
}

type PendingDeco = { from: number; to: number; deco: Decoration };

function buildDecorations(
  view: EditorView,
  noteExists: (target: string) => boolean,
  notaId: string | null = null,
): DecorationSet {
  const decos: PendingDeco[] = [];
  const doc = view.state.doc;

  // Marcadores de cita al inicio de la línea (uno o varios `>` anidados).
  const QUOTE_RE = /^((?:\s*>\s?)+)/;
  const contarProf = (marcadores: string): number => (marcadores.match(/>/g) ?? []).length;

  // ¿El callout de profundidad `prof` continúa en la línea siguiente? Sirve para
  // marcar su última línea (no se puede envolver el callout en un <div> en CM).
  // No continúa si: no hay línea, la cita se acorta por debajo de `prof`, o
  // aparece una cabecera de callout nueva a profundidad ≤ `prof` (la reemplaza).
  const continuaEnProf = (lineNumber: number, prof: number): boolean => {
    if (lineNumber >= doc.lines) return false;
    const t = doc.line(lineNumber + 1).text;
    const m = QUOTE_RE.exec(t);
    if (!m || contarProf(m[1]) < prof) return false;
    const head = CALLOUT_HEAD_RE.exec(t);
    if (head && contarProf(head[1]) <= prof) return false;
    return true;
  };

  // Líneas "activas": las tocadas por el cursor o la selección (CA1/CA2)
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line++) activeLines.add(line);
  }

  // Rangos que ya gestionan los StateFields de bloque (tablas y frontmatter): se
  // omiten aquí para no decorar dos veces ni solapar rangos en el RangeSet.
  const bloquesRenderizados = [
    ...(view.state.field(frontmatterField, false)?.ranges ?? []),
    ...(view.state.field(tableField, false)?.ranges ?? []),
  ];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Omitir cualquier nodo dentro de un bloque ya renderizado (tabla/frontmatter)
        if (bloquesRenderizados.some(([f, t]) => node.from >= f && node.from < t)) {
          return false;
        }

        const headingMatch = /^ATXHeading([1-6])$/.exec(node.name);
        if (headingMatch) {
          const line = doc.lineAt(node.from);
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: `mic-live-h${headingMatch[1]}` }),
          });
          return;
        }

        // Regla horizontal (--- *** ___): se muestra como separador cuando el
        // cursor no está en la línea; al entrar, se ve el texto crudo para editar.
        if (node.name === "HorizontalRule") {
          const line = doc.lineAt(node.from);
          if (!activeLines.has(line.number)) {
            decos.push({
              from: line.from,
              to: line.to,
              deco: Decoration.replace({ widget: new HrWidget() }),
            });
          }
          return false;
        }

        // Bloque de código cercado: fondo/estilo de bloque por línea (HU-03).
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            const ln = doc.line(n);
            const edge = n === first ? " mic-live-code-first" : n === last ? " mic-live-code-last" : "";
            decos.push({
              from: ln.from,
              to: ln.from,
              deco: Decoration.line({ class: `mic-live-code${edge}` }),
            });
          }
          return;
        }

        // Énfasis con `_` (estilo propio de Mycelium): _x_ cursiva + glow,
        // __x__ negrita + accent, ___x___ negrita sin cursiva + degradado. Los
        // de `*` usan el resaltado estándar (cursiva/negrita) y no se tocan.
        if (node.name === "Emphasis" || node.name === "StrongEmphasis") {
          const marks = node.node.getChildren("EmphasisMark");
          if (marks.length >= 2 && doc.sliceString(marks[0].from, marks[0].from + 1) === "_") {
            const line = doc.lineAt(node.from);
            const isActive = activeLines.has(line.number);
            const strong = node.name === "Emphasis" ? node.node.getChild("StrongEmphasis") : null;
            if (strong) {
              // ___texto___ → triple: ocultar todas las marcas y pintar el centro
              const im = strong.getChildren("EmphasisMark");
              const cFrom = im.length >= 2 ? im[0].to : strong.from;
              const cTo = im.length >= 2 ? im[im.length - 1].from : strong.to;
              if (!isActive) {
                decos.push({ from: node.from, to: cFrom, deco: hide });
                decos.push({ from: cTo, to: node.to, deco: hide });
              }
              if (cFrom < cTo) {
                decos.push({ from: cFrom, to: cTo, deco: Decoration.mark({ class: "mic-em-cm-tri" }) });
              }
              return false; // ya gestionamos marcas y contenido
            }
            const cFrom = marks[0].to;
            const cTo = marks[marks.length - 1].from;
            if (cFrom < cTo) {
              decos.push({
                from: cFrom,
                to: cTo,
                deco: Decoration.mark({
                  class: node.name === "Emphasis" ? "mic-em-cm-us" : "mic-strong-cm-us",
                }),
              });
            }
            // sin return: el caso EmphasisMark oculta las marcas fuera de foco
          }
        }

        switch (node.name) {
          case "HeaderMark": {
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              // Ocultar también el espacio que sigue a los #
              let end = node.to;
              if (end < doc.length && doc.sliceString(end, end + 1) === " ") end++;
              decos.push({ from: node.from, to: end, deco: hide });
            }
            break;
          }
          case "CodeMark": {
            // Fences de bloque (```) permanecen visibles; los backticks inline
            // se ocultan fuera de la línea activa.
            const parent = node.node.parent?.name;
            if (parent === "FencedCode" || parent === "CodeBlock") break;
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              decos.push({ from: node.from, to: node.to, deco: hide });
            }
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "LinkMark":
          case "URL": {
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              decos.push({ from: node.from, to: node.to, deco: hide });
            }
            break;
          }
          case "ListMark": {
            // Marcador de lista (- * + o 1.) coloreado, no se oculta (HU-01)
            decos.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: "mic-list-mark" }),
            });
            break;
          }
          case "TaskMarker": {
            // `[ ]`/`[x]` → checkbox visual fuera de la línea activa; al entrar
            // el cursor se ve el texto crudo para editarlo.
            const line = doc.lineAt(node.from);
            if (!activeLines.has(line.number)) {
              const checked = /\[[xX]\]/.test(doc.sliceString(node.from, node.to));
              decos.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new CheckboxWidget(checked) }),
              });
            }
            break;
          }
        }
      },
    });

    // [[wikilinks]], #tags, citas y callouts se detectan por línea.
    let pos = from;
    // Callouts anidados (DEF-022): tipos y estado de plegado POR PROFUNDIDAD de
    // blockquote. `tipos[d-1]` = tipo del callout activo a profundidad d (o
    // undefined si a esa profundidad hay cita sin cabecera de callout).
    const tipos: (string | undefined)[] = [];
    const colapsado: boolean[] = [];
    let firstBodyDepth = 0; // profundidad cuya próxima línea de cuerpo es la 1ª
    while (pos <= to) {
      const line = doc.lineAt(pos);

      // Saltar líneas que quedaron dentro de un bloque ya renderizado
      if (bloquesRenderizados.some(([f, t]) => line.from >= f && line.from <= t)) {
        if (line.to >= to) break;
        pos = line.to + 1;
        continue;
      }

      const isActive = activeLines.has(line.number);
      const text = line.text;

      // Callouts (> [!tipo] …, con anidamiento — DEF-022) y citas (>) en vivo.
      const headMatch = CALLOUT_HEAD_RE.exec(text);
      const quote = QUOTE_RE.exec(text);
      if (quote) {
        const prof = contarProf(quote[1]);
        const markerLen = quote[1].length;
        // Una cita menos profunda cierra los callouts más profundos.
        if (tipos.length > prof) {
          tipos.length = prof;
          colapsado.length = prof;
        }
        const algunColapsado = colapsado.slice(0, prof).some(Boolean);

        if (headMatch) {
          const tipo = headMatch[2].toLowerCase();
          const symbol = headMatch[3];
          const estePlegado = symbol === "-";
          const foldable = symbol === "-" || symbol === "+";
          tipos[prof - 1] = tipo;
          colapsado[prof - 1] = estePlegado;
          firstBodyDepth = prof; // la siguiente línea `>` a esta prof. es la 1ª del cuerpo
          // Ganchos por línea (no se puede englobar el callout en un div):
          // -first/-last delimitan; -foldable/-collapsed dan el estado; data-callout
          // el tipo (color/ícono) y data-callout-depth la profundidad (indentado).
          let headClass = "mic-live-callout mic-live-callout-head mic-live-callout-first";
          if (foldable) headClass += " mic-live-callout-foldable";
          if (estePlegado) headClass += " mic-live-callout-collapsed";
          if (estePlegado || !continuaEnProf(line.number, prof)) headClass += " mic-live-callout-last";
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({
              class: headClass,
              attributes: { "data-callout": tipo, "data-callout-depth": String(prof) },
            }),
          });
          if (foldable) {
            decos.push({
              from: line.from,
              to: line.from,
              deco: Decoration.widget({
                widget: new FoldWidget(line.from, estePlegado),
                side: -1,
              }),
            });
          }
          // Fuera de la línea activa, ocultar el marcador (`> …[!tipo]-/+`) y dejar
          // solo el título; si no hay título, mostrar la etiqueta del tipo.
          if (!isActive) {
            const afterMarker = text.slice(headMatch[0].length);
            const titulo = afterMarker.replace(/^[ \t]+/, "");
            const titleStartCol = headMatch[0].length + (afterMarker.length - titulo.length);
            if (titulo.length > 0) {
              decos.push({ from: line.from, to: line.from + titleStartCol, deco: hide });
            } else {
              decos.push({
                from: line.from,
                to: line.to,
                deco: Decoration.replace({
                  widget: new LabelWidget(CALLOUT_LABELS[tipo] ?? tipo),
                }),
              });
            }
          }
        } else if (tipos[prof - 1]) {
          // Cuerpo de un callout a esta profundidad.
          const tipo = tipos[prof - 1]!;
          let cls = "mic-live-callout mic-live-callout-body";
          if (firstBodyDepth === prof) cls += " mic-live-callout-body-first";
          firstBodyDepth = 0;
          if (algunColapsado) cls += " mic-callout-hidden";
          if (!continuaEnProf(line.number, prof)) cls += " mic-live-callout-last";
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({
              class: cls,
              attributes: { "data-callout": tipo, "data-callout-depth": String(prof) },
            }),
          });
          // Ocultar los marcadores de cita `>` del cuerpo fuera de la línea activa
          if (!isActive && !algunColapsado) {
            decos.push({ from: line.from, to: line.from + markerLen, deco: hide });
          }
        } else {
          // Cita simple (posiblemente anidada) sin cabecera de callout.
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: "mic-live-quote" }),
          });
          if (!isActive) {
            decos.push({ from: line.from, to: line.from + markerLen, deco: hide });
          }
        }
      } else {
        // Línea sin `>` (en blanco u otra): cierra TODO callout/cita en curso
        // (DEF-021: una línea vacía termina el blockquote en markdown). Para
        // continuar un callout tras un párrafo se usa una línea `>` vacía.
        tipos.length = 0;
        colapsado.length = 0;
        firstBodyDepth = 0;
      }

      // Embeds de excalidraw (`![[ref.excalidraw]]`): se renderizan como bloque
      // cuando ocupan toda la línea y el cursor no está en ella. Sus rangos se
      // excluyen del paso de wikilinks (el `[[…]]` interno no debe estilarse).
      const exRanges: [number, number][] = [];
      for (const match of line.text.matchAll(EXCALIDRAW_RE)) {
        const mFrom = line.from + match.index;
        exRanges.push([mFrom, mFrom + match[0].length]);
        if (!isActive && text.trim() === match[0]) {
          decos.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({
              widget: new ExcalidrawWidget(match[1], notaId, line.from, liveGen),
            }),
          });
        }
      }

      for (const match of line.text.matchAll(WIKILINK_RE)) {
        const start = line.from + match.index;
        if (exRanges.some(([f, t]) => start >= f && start < t)) continue;
        const innerFrom = start + 2;
        const innerTo = innerFrom + match[1].length;
        // [[destino|alias]]: el destino navega, el alias es lo visible.
        const pipe = match[1].indexOf("|");
        const target = (pipe === -1 ? match[1] : match[1].slice(0, pipe)).trim();
        // Tramo que se muestra estilizado (alias si lo hay; si no, el destino).
        const labelFrom = pipe === -1 ? innerFrom : innerFrom + pipe + 1;
        if (!isActive) {
          // Oculta `[[` y, si hay alias, también `destino|`.
          decos.push({ from: start, to: labelFrom, deco: hide });
        }
        // Feedback de inexistencia: mismo color, más oscuro (CA8 mejora).
        const missing = !noteExists(target);
        decos.push({
          from: labelFrom,
          to: innerTo,
          deco: Decoration.mark({
            class: missing ? "mic-wikilink-cm mic-wikilink-cm-missing" : "mic-wikilink-cm",
            attributes: { "data-title": target },
          }),
        });
        if (!isActive) {
          decos.push({ from: innerTo, to: start + match[0].length, deco: hide });
        }
      }

      for (const match of line.text.matchAll(TAG_RE)) {
        const start = line.from + match.index + match[1].length;
        decos.push({
          from: start,
          to: start + match[2].length + 1,
          deco: Decoration.mark({ class: "mic-tag-cm" }),
        });
      }

      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }

  decos.sort(
    (a, b) =>
      a.from - b.from ||
      a.deco.startSide - b.deco.startSide ||
      a.to - b.to,
  );

  const builder = new RangeSetBuilder<Decoration>();
  let lastFrom = -1;
  let lastTo = -1;
  for (const { from, to, deco } of decos) {
    // RangeSetBuilder exige orden estricto; saltear duplicados exactos
    if (from === lastFrom && to === lastTo && to !== from) continue;
    builder.add(from, to, deco);
    lastFrom = from;
    lastTo = to;
  }
  return builder.finish();
}
