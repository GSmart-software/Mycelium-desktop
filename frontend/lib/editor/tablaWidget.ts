/**
 * Tabla EDITABLE del editor en vivo (`FUN-L-19`, `EDITOR-TABLAS-EN-SITIO`).
 * Ver `docs/features/edicion-en-el-render.md` § 5.
 *
 * Es el DOM que vive dentro del widget de bloque de `livePreview.ts`: escribir
 * en una celda, insertar/eliminar/mover filas y columnas y alinear una columna
 * — todo con la tabla RENDERIZADA, sin abrir el markdown en crudo. El motor
 * (parsear/serializar y las operaciones) está en `lib/tablas.ts`, puro y con
 * tests; acá solo hay interfaz.
 *
 * Las seis reglas del widget de bloque interactivo (ver
 * `docs/aprendizajes/CodeMirror y la vista en vivo.md`) aplican todas:
 *
 * 1. **Espaciado con `padding`, nunca `margin`** — está en `styles/editor.css`.
 *    Es la que ya costó `DEF-031`/`DEF-037`, y fue en ESTE widget.
 * 2. **Se parchea en sitio** (`sincronizar()` + `updateDOM()` del widget):
 *    reconstruir en cada tecla le sacaría el foco a la celda que se escribe.
 * 3. Los eventos de los controles NO son de CodeMirror (`esControlDeTabla`).
 * 4. Cada operación escribe el rango mínimo, con `userEvent` propio.
 * 5. **Todo cambio de alto pide medida** (`acciones.medir()`).
 * 6. El rango de la tabla es un átomo (`EditorView.atomicRanges`, en
 *    `livePreview.ts`), porque ya no se abre en crudo con el cursor dentro.
 *
 * Los tiradores no cambian el alto al aparecer: ocupan su lugar siempre
 * (`visibility`), y el menú es absoluto. Un tirador que empujara el layout al
 * pasar el puntero obligaría a medir en cada `mouseover`.
 */

import { renderMarkdown, renderMarkdownEnLinea } from "@/lib/markdown";
import {
  alinear,
  celdaDe,
  columnasDe,
  eliminarColumna,
  eliminarFila,
  insertarColumna,
  insertarFila,
  moverColumna,
  moverFila,
  parsear,
  ponerCelda,
  type Alineacion,
  type Tabla,
} from "@/lib/tablas";

/** Lo que la tabla le pide al editor. */
export type AccionesTabla = {
  /** Aplica una operación de `lib/tablas.ts` al bloque del documento. */
  editar(transformar: (t: Tabla) => Tabla): void;
  /** «Editar como texto»: revela el markdown del bloque hasta que salga el cursor. */
  verComoTexto(): void;
  /** Devuelve el foco al editor (lo que hace `Escape` desde una celda). */
  salirAlEditor(): void;
  /** Avisa que el alto del bloque cambió (`view.requestMeasure()`). */
  medir(): void;
};

/** Propiedad de la que cuelga el controlador en el DOM del widget. */
const CONTROL = "__micTabla";

type ConControl = HTMLElement & { [CONTROL]?: TablaEnSitio };

/** El controlador de un DOM de widget ya construido, si lo tiene. */
export function controlTablaDe(dom: HTMLElement): TablaEnSitio | undefined {
  return (dom as ConControl)[CONTROL];
}

/**
 * ¿El evento nació en un control de la tabla? Es lo que decide el
 * `ignoreEvent()` del widget: `true` para los controles (los eventos son
 * nuestros) y `false` para el resto, donde el clic sigue siendo de CodeMirror.
 */
export function esControlDeTabla(destino: EventTarget | null): boolean {
  const el = destino instanceof Element ? destino : null;
  return el?.closest("input, button, select, textarea, .mic-tab-celda, .mic-tab-menu") != null;
}

/** Nombre visible de cada alineación (menú de la columna). */
const NOMBRE_ALINEACION: Record<Alineacion, string> = {
  izquierda: "Izquierda",
  centro: "Centro",
  derecha: "Derecha",
  sin: "Sin alinear",
};

const ALINEACIONES: Alineacion[] = ["izquierda", "centro", "derecha", "sin"];

function boton(clase: string, texto: string, titulo: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = clase;
  b.textContent = texto;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  return b;
}

/** Índice de fila (-1 = encabezado) y de columna de una celda del DOM. */
type Coord = { fila: number; columna: number };

/** Cómo se nombra una celda para quien no la ve (lector de pantalla). */
const nombreDeCelda = (fila: number, columna: number): string =>
  fila === -1
    ? `Título de la columna ${columna + 1}`
    : `Fila ${fila + 1}, columna ${columna + 1}`;

const coordDe = (celda: HTMLElement): Coord => ({
  fila: Number(celda.dataset.fila),
  columna: Number(celda.dataset.columna),
});

/**
 * La tabla completa dentro del widget. Se construye UNA vez y se parchea con
 * `sincronizar()`: el estado vive en el DOCUMENTO, nunca acá, así que un cambio
 * desde fuera (o desde otra vista de la misma nota) se refleja igual.
 */
export class TablaEnSitio {
  readonly dom: HTMLElement;
  /** Contenedor del contenido: `<blockquote>` si la tabla está en una cita. */
  private caja: HTMLElement;
  private readonly menuEl: HTMLElement;
  private readonly pieEl: HTMLElement;
  private readonly btnFila: HTMLButtonElement;
  private readonly btnColumna: HTMLButtonElement;
  private readonly avisoEl: HTMLElement;
  private tablaEl: HTMLTableElement | null = null;
  /** La tabla del documento tal como se pintó por última vez. */
  private tabla: Tabla | null = null;
  /** El markdown ya pintado, para no repintar de más. */
  private pintado: string | null = null;
  /** `<input>` abierto sobre una celda, o null. */
  private editor: HTMLInputElement | null = null;
  private editando: Coord | null = null;

  constructor(private readonly acciones: AccionesTabla) {
    this.dom = document.createElement("div");
    this.dom.className = "mic-preview mic-live-table mic-tab";
    (this.dom as ConControl)[CONTROL] = this;

    this.caja = document.createElement("div");
    this.caja.className = "mic-tab-caja";

    this.avisoEl = document.createElement("p");
    this.avisoEl.className = "mic-tab-aviso";
    this.avisoEl.hidden = true;

    this.pieEl = document.createElement("div");
    this.pieEl.className = "mic-tab-pie";
    this.btnFila = boton("mic-tab-btn", "+ Fila", "Agregar una fila al final");
    this.btnFila.addEventListener("click", () =>
      this.operar((t) => insertarFila(t, t.filas.length)),
    );
    this.btnColumna = boton("mic-tab-btn", "+ Columna", "Agregar una columna al final");
    this.btnColumna.addEventListener("click", () =>
      this.operar((t) => insertarColumna(t, columnasDe(t))),
    );
    const btnTexto = boton("mic-tab-btn mic-tab-texto", "Editar como texto", "Editar la tabla como texto");
    btnTexto.addEventListener("click", () => this.acciones.verComoTexto());
    this.pieEl.append(this.btnFila, this.btnColumna, btnTexto);

    this.menuEl = document.createElement("div");
    this.menuEl.className = "mic-tab-menu";
    this.menuEl.hidden = true;
    this.menuEl.setAttribute("role", "menu");
    this.menuEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.cerrarMenu(true);
      }
    });

    this.dom.append(this.caja, this.avisoEl, this.pieEl, this.menuEl);

    // Los enlaces de las celdas (wikilinks, `#tag:`) navegan en la vista de
    // lectura, no acá: dentro del editor un href `#…` cambiaría la URL del
    // workspace.
    this.dom.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a")) event.preventDefault();
    });
  }

  /**
   * El widget desaparece del viewport: hay que soltar el listener global del
   * menú. Lo llama `destroy()` del widget de bloque.
   */
  destruir() {
    this.cerrarMenu(false);
  }

  /** Refleja el markdown del bloque parcheando el DOM que ya existe. */
  sincronizar(md: string) {
    if (md === this.pintado) return;
    this.pintado = md;
    const t = parsear(md);
    this.tabla = t;

    if (!t) {
      // Lo que no sabemos reescribir se muestra como hasta ahora —renderizado y
      // sin controles— con el motivo a la vista: reescribir a ciegas sería
      // romperle la tabla a alguien.
      this.editor = null;
      this.editando = null;
      this.tablaEl = null;
      this.cerrarMenu(false);
      this.caja.className = "mic-tab-caja";
      this.caja.innerHTML = renderMarkdown(md);
      this.avisoEl.hidden = false;
      this.avisoEl.textContent =
        "Mycelium no puede reescribir esta tabla sin riesgo (formato irregular). Usá «Editar como texto» para tocarla a mano.";
      this.btnFila.hidden = true;
      this.btnColumna.hidden = true;
      return;
    }

    this.avisoEl.hidden = true;
    this.btnFila.hidden = false;
    this.btnColumna.hidden = false;
    // Una tabla dentro de una cita/callout se sigue viendo dentro de su cita.
    const clase = t.sangria.includes(">") ? "mic-tab-caja mic-tab-caja-cita" : "mic-tab-caja";
    if (this.caja.className !== clase) this.caja.className = clase;
    this.patchTabla(t);
  }

  // ── Estructura ─────────────────────────────────────────────────────────────

  private patchTabla(t: Tabla) {
    if (!this.tablaEl) {
      this.caja.replaceChildren();
      this.tablaEl = document.createElement("table");
      this.tablaEl.className = "mic-tab-tabla";
      this.tablaEl.append(document.createElement("thead"), document.createElement("tbody"));
      this.caja.append(this.tablaEl);
    }
    const columnas = columnasDe(t);
    const thead = this.tablaEl.tHead!;
    const tbody = this.tablaEl.tBodies[0];

    const filaEnc = (thead.rows[0] as HTMLTableRowElement | undefined) ?? thead.insertRow();
    this.patchLateral(filaEnc, "th", -1);
    for (let j = 0; j < columnas; j++) {
      const th = this.patchCelda(filaEnc, "th", -1, j, t);
      this.patchMenuColumna(th, j);
    }
    this.recortar(filaEnc, columnas + 1);

    for (let i = 0; i < t.filas.length; i++) {
      const tr = (tbody.rows[i] as HTMLTableRowElement | undefined) ?? tbody.insertRow();
      this.patchLateral(tr, "td", i);
      for (let j = 0; j < columnas; j++) this.patchCelda(tr, "td", i, j, t);
      this.recortar(tr, columnas + 1);
    }
    while (tbody.rows.length > t.filas.length) tbody.deleteRow(tbody.rows.length - 1);
  }

  private recortar(tr: HTMLTableRowElement, cuantas: number) {
    while (tr.cells.length > cuantas) tr.deleteCell(tr.cells.length - 1);
  }

  /** La celda lateral (izquierda) con el tirador de la fila. */
  private patchLateral(tr: HTMLTableRowElement, etiqueta: "th" | "td", fila: number) {
    let celda = tr.cells[0] as HTMLTableCellElement | undefined;
    if (!celda || celda.tagName.toLowerCase() !== etiqueta || !celda.classList.contains("mic-tab-lat")) {
      celda = document.createElement(etiqueta);
      celda.className = "mic-tab-lat";
      tr.insertBefore(celda, tr.cells[0] ?? null);
    }
    if (fila === -1) {
      // La esquina no tiene tirador: el encabezado no se elimina ni se mueve.
      celda.replaceChildren();
      return;
    }
    let btn = celda.querySelector<HTMLButtonElement>(".mic-tab-tirador");
    if (!btn) {
      btn = boton("mic-tab-tirador", "⋮", "Opciones de la fila");
      btn.addEventListener("click", () => this.abrirMenuFila(btn!, Number(btn!.dataset.fila)));
      celda.replaceChildren(btn);
    }
    btn.dataset.fila = String(fila);
    btn.title = `Opciones de la fila ${fila + 1}`;
    btn.setAttribute("aria-label", btn.title);
  }

  /** El botón de menú que vive dentro de cada celda del encabezado. */
  private patchMenuColumna(th: HTMLTableCellElement, columna: number) {
    let btn = th.querySelector<HTMLButtonElement>(".mic-tab-tirador");
    if (!btn) {
      btn = boton("mic-tab-tirador mic-tab-tirador-col", "⋯", "Opciones de la columna");
      btn.addEventListener("click", () => this.abrirMenuColumna(btn!, Number(btn!.dataset.columna)));
      th.append(btn);
    }
    btn.dataset.columna = String(columna);
    btn.title = `Opciones de la columna ${columna + 1}`;
    btn.setAttribute("aria-label", btn.title);
  }

  /**
   * Una celda: el markdown RENDERIZADO, que pasa a `<input>` al recibir el foco.
   * Es el "grano fino" de la spec § 3.2 — se abre la celda donde está el cursor,
   * no la tabla entera.
   */
  private patchCelda(
    tr: HTMLTableRowElement,
    etiqueta: "th" | "td",
    fila: number,
    columna: number,
    t: Tabla,
  ): HTMLTableCellElement {
    const indice = columna + 1;
    let celda = tr.cells[indice] as HTMLTableCellElement | undefined;
    if (!celda || celda.tagName.toLowerCase() !== etiqueta || celda.classList.contains("mic-tab-lat")) {
      celda = document.createElement(etiqueta);
      tr.insertBefore(celda, tr.cells[indice] ?? null);
    }
    celda.dataset.fila = String(fila);
    celda.dataset.columna = String(columna);
    const alineacion = t.alineaciones[columna];
    const clase = `mic-tab-celda mic-tab-al-${alineacion}`;
    if (celda.className !== clase) celda.className = clase;

    const texto = celdaDe(t, fila, columna);
    // Lo que tiene el foco no se toca: repintarlo es perder lo que se escribe.
    if (this.editor && this.editando?.fila === fila && this.editando.columna === columna) {
      celda.dataset.md = texto;
      return celda;
    }
    if (celda.dataset.md === texto && celda.querySelector(".mic-tab-render")) return celda;
    celda.dataset.md = texto;

    const render = document.createElement("span");
    render.className = "mic-tab-render";
    render.tabIndex = 0;
    render.setAttribute("role", "textbox");
    render.setAttribute("aria-label", nombreDeCelda(fila, columna));
    // Una celda vacía queda como un hueco enfocable (el `min-width`/`min-height`
    // de `.mic-tab-render`), no como una celda muerta.
    if (texto !== "") render.innerHTML = renderMarkdownEnLinea(texto);
    render.addEventListener("focus", () => this.abrirEditor(celda!));
    const tirador = celda.querySelector(".mic-tab-tirador");
    celda.replaceChildren(render);
    if (tirador) celda.append(tirador);
    return celda;
  }

  // ── Edición de una celda ───────────────────────────────────────────────────

  private abrirEditor(celda: HTMLTableCellElement) {
    if (this.editor) return;
    const { fila, columna } = coordDe(celda);
    const input = document.createElement("input");
    input.className = "mic-tab-input";
    input.type = "text";
    input.value = celda.dataset.md ?? "";
    input.setAttribute("aria-label", nombreDeCelda(fila, columna));
    this.editor = input;
    this.editando = { fila, columna };

    const tirador = celda.querySelector(".mic-tab-tirador");
    celda.replaceChildren(input);
    if (tirador) celda.append(tirador);
    input.focus();
    input.select();

    // Perder el foco confirma (spec § 3.3): es la salida más común, y el
    // `blur` llega también cuando el clic se va a otra celda o al menú.
    input.addEventListener("blur", () => this.confirmar(celda));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.altKey) {
        // Entrada por teclado a los tiradores: Alt+Enter abre el menú de la
        // fila; con Shift, el de la columna. Nada de esto exige el ratón.
        e.preventDefault();
        this.confirmar(celda);
        this.abrirMenuDesdeTeclado(fila, columna, e.shiftKey);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.confirmar(celda);
        this.enfocarCelda(fila, columna);
      } else if (e.key === "Escape") {
        // Descarta y sale al editor (spec § 3.3 y § 3.6). El editor se anula
        // ANTES de repintar para que el `blur` no confirme lo descartado.
        e.preventDefault();
        this.editor = null;
        this.editando = null;
        this.repintarCelda(celda);
        this.acciones.salirAlEditor();
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.confirmar(celda);
        this.moverFoco(fila, columna, e.shiftKey ? -1 : 1);
      }
    });
    this.acciones.medir();
  }

  /** Escribe la celda en el documento y vuelve al render. */
  private confirmar(celda: HTMLTableCellElement) {
    const input = this.editor;
    if (!input || input.parentElement !== celda) return;
    const { fila, columna } = coordDe(celda);
    const texto = input.value;
    // Antes de escribir: el dispatch vuelve por `sincronizar()` y no debe
    // encontrarse un editor abierto que ya no lo está.
    this.editor = null;
    this.editando = null;

    if (texto !== (celda.dataset.md ?? "")) {
      this.operar((t) => ponerCelda(t, fila, columna, texto));
    }
    this.repintarCelda(celda);
    this.acciones.medir();
  }

  /** Fuerza el repintado de una celda (su huella ya no vale tras editarla). */
  private repintarCelda(celda: HTMLTableCellElement) {
    const t = this.tabla;
    if (!t) return;
    const { fila, columna } = coordDe(celda);
    delete celda.dataset.md;
    const tr = celda.parentElement as HTMLTableRowElement | null;
    if (tr) this.patchCelda(tr, celda.tagName.toLowerCase() as "th" | "td", fila, columna, t);
  }

  /** Siguiente/anterior celda en orden de lectura (encabezado incluido). */
  private moverFoco(fila: number, columna: number, paso: number) {
    const t = this.tabla;
    if (!t) return;
    const columnas = columnasDe(t);
    const total = (t.filas.length + 1) * columnas;
    const indice = (fila + 1) * columnas + columna + paso;
    if (indice < 0) return;
    if (indice >= total) {
      // Después de la última celda viene el pie, que es lo que sigue en la
      // lectura: así se llega a «+ Fila» sin tocar el ratón.
      this.btnFila.focus();
      return;
    }
    const destino = { fila: Math.floor(indice / columnas) - 1, columna: indice % columnas };
    this.enfocarCelda(destino.fila, destino.columna);
  }

  private celdaDom(fila: number, columna: number): HTMLTableCellElement | null {
    return (
      this.tablaEl?.querySelector<HTMLTableCellElement>(
        `.mic-tab-celda[data-fila="${fila}"][data-columna="${columna}"]`,
      ) ?? null
    );
  }

  private enfocarCelda(fila: number, columna: number) {
    const celda = this.celdaDom(fila, columna);
    celda?.querySelector<HTMLElement>(".mic-tab-render")?.focus();
  }

  // ── Menús de los tiradores ─────────────────────────────────────────────────

  private abrirMenuDesdeTeclado(fila: number, columna: number, columnaNo: boolean) {
    if (columnaNo) {
      const btn = this.tablaEl?.querySelector<HTMLButtonElement>(
        `.mic-tab-tirador-col[data-columna="${columna}"]`,
      );
      if (btn) this.abrirMenuColumna(btn, columna);
      return;
    }
    if (fila === -1) return; // el encabezado no tiene menú de fila
    const btn = this.celdaDom(fila, 0)
      ?.parentElement?.querySelector<HTMLButtonElement>(".mic-tab-lat .mic-tab-tirador");
    if (btn) this.abrirMenuFila(btn, fila);
  }

  private abrirMenuFila(origen: HTMLElement, fila: number) {
    const t = this.tabla;
    if (!t) return;
    const items: HTMLElement[] = [
      this.item("Insertar fila encima", (d) => insertarFila(d, fila)),
      this.item("Insertar fila debajo", (d) => insertarFila(d, fila + 1)),
      this.item("Mover arriba", (d) => moverFila(d, fila, fila - 1), fila > 0),
      this.item("Mover abajo", (d) => moverFila(d, fila, fila + 1), fila < t.filas.length - 1),
      this.item("Eliminar la fila", (d) => eliminarFila(d, fila)),
    ];
    this.mostrarMenu(origen, items, { fila, columna: 0 });
  }

  private abrirMenuColumna(origen: HTMLElement, columna: number) {
    const t = this.tabla;
    if (!t) return;
    const ultima = columnasDe(t) - 1;
    const items: HTMLElement[] = [
      this.item("Insertar columna a la izquierda", (d) => insertarColumna(d, columna)),
      this.item("Insertar columna a la derecha", (d) => insertarColumna(d, columna + 1)),
      this.item("Mover a la izquierda", (d) => moverColumna(d, columna, columna - 1), columna > 0),
      this.item("Mover a la derecha", (d) => moverColumna(d, columna, columna + 1), columna < ultima),
      this.item("Eliminar la columna", (d) => eliminarColumna(d, columna), ultima > 0),
    ];
    const grupo = document.createElement("div");
    grupo.className = "mic-tab-menu-grupo";
    const titulo = document.createElement("span");
    titulo.className = "mic-tab-menu-titulo";
    titulo.textContent = "Alinear";
    grupo.append(titulo);
    for (const a of ALINEACIONES) {
      const btn = this.item(NOMBRE_ALINEACION[a], (d) => alinear(d, columna, a));
      if (t.alineaciones[columna] === a) btn.setAttribute("aria-current", "true");
      grupo.append(btn);
    }
    items.push(grupo);
    this.mostrarMenu(origen, items, { fila: -1, columna });
  }

  /** Un ítem de menú: aplica una operación pura y cierra. */
  private item(
    texto: string,
    operacion: (t: Tabla) => Tabla,
    habilitado = true,
  ): HTMLButtonElement {
    const btn = boton("mic-tab-menu-item", texto, texto);
    btn.disabled = !habilitado;
    btn.addEventListener("click", () => {
      this.cerrarMenu(false);
      this.operar(operacion);
    });
    return btn;
  }

  /**
   * Un clic fuera del menú lo cierra. Va en captura y a nivel de documento —no
   * en `focusout`— porque no todos los navegadores enfocan un `<button>` al
   * pulsarlo, y ahí el menú se cerraría antes de que llegara el clic del ítem.
   */
  private readonly cerrarAlClicFuera = (event: MouseEvent) => {
    const destino = event.target;
    if (!(destino instanceof Node) || !this.menuEl.contains(destino)) this.cerrarMenu(false);
  };

  /**
   * El menú está fijo a la ventana (ver el CSS), así que no acompaña al scroll
   * de la tabla ni del editor: si algo se desplaza, se cierra. Cerrar y no
   * recolocar es lo que hacen el menú contextual y el del grafo, y evita un
   * menú que persigue a su tirador por la pantalla.
   */
  private readonly cerrarAlDesplazar = () => this.cerrarMenu(false);

  /**
   * Lo pega al tirador y lo mantiene DENTRO de la ventana: si no entra abajo,
   * se abre hacia arriba; si se sale por un lado, se recuesta contra el borde.
   * Se mide con el menú ya visible y con la posición reseteada, porque
   * `getBoundingClientRect` de un elemento oculto devuelve ceros.
   */
  private situarMenu(origen: HTMLElement) {
    const MARGEN = 8;
    this.menuEl.style.left = "0px";
    this.menuEl.style.top = "0px";
    const menu = this.menuEl.getBoundingClientRect();
    const r = origen.getBoundingClientRect();
    const maxX = window.innerWidth - menu.width - MARGEN;
    const maxY = window.innerHeight - menu.height - MARGEN;
    const y = r.bottom > maxY ? r.top - menu.height : r.bottom;
    this.menuEl.style.left = `${Math.max(MARGEN, Math.min(r.left, maxX))}px`;
    this.menuEl.style.top = `${Math.max(MARGEN, Math.min(y, maxY))}px`;
  }

  private mostrarMenu(origen: HTMLElement, items: HTMLElement[], volverA: Coord) {
    this.menuEl.replaceChildren(...items);
    if (this.menuEl.hidden) {
      document.addEventListener("mousedown", this.cerrarAlClicFuera, true);
    }
    this.menuEl.hidden = false;
    this.menuEl.dataset.fila = String(volverA.fila);
    this.menuEl.dataset.columna = String(volverA.columna);
    this.situarMenu(origen);
    // `preventScroll` y el orden importan: enfocar puede desplazar el contenedor,
    // y ese scroll dispararía el cierre que se registra justo después.
    this.menuEl
      .querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus({ preventScroll: true });
    window.addEventListener("scroll", this.cerrarAlDesplazar, true);
    window.addEventListener("resize", this.cerrarAlDesplazar);
  }

  private cerrarMenu(devolverFoco: boolean) {
    if (this.menuEl.hidden) return;
    document.removeEventListener("mousedown", this.cerrarAlClicFuera, true);
    window.removeEventListener("scroll", this.cerrarAlDesplazar, true);
    window.removeEventListener("resize", this.cerrarAlDesplazar);
    this.menuEl.hidden = true;
    const fila = Number(this.menuEl.dataset.fila);
    const columna = Number(this.menuEl.dataset.columna);
    this.menuEl.replaceChildren();
    if (devolverFoco) this.enfocarCelda(fila, columna);
  }

  /**
   * Aplica una operación al documento. El `transformar` recibe la tabla RECIÉN
   * leída del documento —no la que se pintó—, porque entre medio pudo cambiar
   * desde otra vista de la misma nota.
   */
  private operar(transformar: (t: Tabla) => Tabla) {
    this.acciones.editar(transformar);
    this.acciones.medir();
  }
}
