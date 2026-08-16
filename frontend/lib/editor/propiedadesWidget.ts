/**
 * Tarjeta de propiedades EDITABLE del editor en vivo (`FUN-M-19`,
 * `EDITOR-PROPIEDADES-EN-SITIO`). Ver `docs/features/edicion-en-el-render.md`.
 *
 * Es el DOM que vive dentro del widget de bloque de `livePreview.ts`: cambia un
 * valor con el control de su tipo, renombra una clave, agrega y quita
 * propiedades — todo sin abrir el YAML en crudo.
 *
 * Cuatro cosas que NO se pueden hacer mal acá (spec § 2, son la diferencia con
 * `DEF-031`/`DEF-037`):
 *
 * 1. **Espaciado con `padding`, nunca `margin`** — está en `styles/editor.css`,
 *    y toda regla nueva de esta tarjeta tiene que respetarlo: CodeMirror mide
 *    los bloques con `offsetHeight`, que no ve los márgenes.
 * 2. **Se parchea en sitio**, nunca se reconstruye: por eso existe
 *    `sincronizar()` y por eso el widget implementa `updateDOM()`. Reconstruir
 *    en cada tecla perdería el foco del campo que se está editando.
 * 3. Los eventos de los controles NO son de CodeMirror (`ignoreEvent()` del
 *    widget se apoya en `esControlDePropiedades`).
 * 4. Cada operación escribe el rango mínimo (`aplicarEdicionFrontmatter`).
 *
 * Y una quinta: **todo cambio de alto pide medida** (`acciones.medir()`), porque
 * abrir el editor de un valor cambia la altura del bloque FUERA del ciclo de
 * actualización de CodeMirror, y su height-map no se enteraría solo.
 *
 * El estado vive en el DOM y en el documento, nunca en la tarjeta: si el
 * archivo cambia desde fuera (o desde otra vista de la misma nota), `sincronizar`
 * lo refleja.
 */

import {
  NOMBRE_TIPO,
  TIPOS_PROPIEDAD,
  separarFrontmatter,
  valorComoTexto,
  valorInicialDe,
  type Propiedad,
  type TipoPropiedad,
  type ValorPropiedad,
} from "@/lib/frontmatter";
import { ICONO_TIPO, valorPropiedadHtml } from "@/lib/markdown";

/** Lo que la tarjeta le pide al editor. Todas pueden lanzar (guarda del YAML). */
export type AccionesPropiedades = {
  /** Crea o cambia una propiedad. */
  poner(clave: string, valor: ValorPropiedad, tipo: TipoPropiedad): void;
  quitar(clave: string): void;
  renombrar(clave: string, nueva: string): void;
  /** «Editar como texto»: revela el markdown del bloque hasta que salga el cursor. */
  verComoTexto(): void;
  /** Avisa que el alto del bloque cambió (`view.requestMeasure()`). */
  medir(): void;
};

/** Propiedad de la que cuelga el controlador en el DOM del widget. */
const CONTROL = "__micPropiedades";

type ConControl = HTMLElement & { [CONTROL]?: TarjetaPropiedades };

/** El controlador de un DOM de widget ya construido, si lo tiene. */
export function controlPropiedadesDe(dom: HTMLElement): TarjetaPropiedades | undefined {
  return (dom as ConControl)[CONTROL];
}

/**
 * ¿El evento nació en un control de la tarjeta? Es lo que decide el
 * `ignoreEvent()` del widget: `true` para los controles (los eventos son
 * nuestros) y `false` para el resto de la tarjeta, donde el clic sigue siendo de
 * CodeMirror y coloca el cursor.
 */
export function esControlDePropiedades(destino: EventTarget | null): boolean {
  const el = destino instanceof Element ? destino : null;
  return el?.closest("input, select, button, textarea, .mic-prop-render") != null;
}

/** El `type=` del `<input>` con el que se edita cada tipo de valor. */
function tipoDeInput(tipo: TipoPropiedad): string {
  if (tipo === "numero") return "number";
  if (tipo === "fecha") return "date";
  if (tipo === "fechaHora") return "datetime-local";
  return "text";
}

function boton(clase: string, texto: string, titulo: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = clase;
  b.textContent = texto;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  return b;
}

/**
 * Una fila de la tarjeta: icono + clave editable + valor + quitar.
 *
 * El valor se muestra RENDERIZADO (el mismo HTML que la vista de lectura) y solo
 * pasa a `<input>` cuando recibe el foco: es el "grano fino" de la spec § 3.2 —
 * se abre el valor donde está el cursor, no el bloque entero. Las casillas y las
 * listas son la excepción razonable: su control ya es su propio render.
 */
class Fila {
  readonly el: HTMLElement;
  private readonly iconoEl: HTMLElement;
  private readonly claveEl: HTMLInputElement;
  private readonly valorEl: HTMLElement;
  private readonly quitarEl: HTMLButtonElement;
  /** `<input>` abierto sobre el valor, o null si está renderizado. */
  private editor: HTMLInputElement | null = null;
  private p: Propiedad;
  /** Huella de la propiedad ya pintada, para no repintar de más. */
  private pintada = "";

  constructor(
    private readonly acciones: AccionesPropiedades,
    private readonly onError: (mensaje: string | null) => void,
    p: Propiedad,
  ) {
    this.p = p;

    this.el = document.createElement("div");
    this.el.className = "mic-prop";

    const claveWrap = document.createElement("span");
    claveWrap.className = "mic-prop-clave";
    this.iconoEl = document.createElement("span");
    this.iconoEl.className = "mic-prop-icono";
    this.iconoEl.setAttribute("aria-hidden", "true");
    this.claveEl = document.createElement("input");
    this.claveEl.className = "mic-prop-clave-input";
    this.claveEl.type = "text";
    claveWrap.append(this.iconoEl, this.claveEl);

    this.valorEl = document.createElement("span");
    this.valorEl.className = "mic-prop-valor";

    this.quitarEl = boton("mic-prop-btn", "×", "Quitar la propiedad");
    this.quitarEl.addEventListener("click", () => this.intentar(() => this.acciones.quitar(this.p.clave)));

    this.el.append(claveWrap, this.valorEl, this.quitarEl);

    this.claveEl.addEventListener("blur", () => {
      const nueva = this.claveEl.value.trim();
      if (nueva === this.p.clave || nueva === "") {
        this.claveEl.value = this.p.clave;
        return;
      }
      this.intentar(() => this.acciones.renombrar(this.p.clave, nueva));
    });
    this.claveEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.claveEl.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.claveEl.value = this.p.clave;
        this.claveEl.blur();
      }
    });

    this.actualizar(p);
  }

  get clave(): string {
    return this.p.clave;
  }

  /** Refleja la propiedad del documento, sin pisar lo que se está editando. */
  actualizar(p: Propiedad) {
    this.p = p;
    const huella = `${p.clave} ${p.tipo} ${JSON.stringify(p.valor)}`;
    if (huella === this.pintada) return;
    this.pintada = huella;

    this.el.dataset.tipo = p.tipo;
    this.iconoEl.textContent = ICONO_TIPO[p.tipo];
    this.quitarEl.title = `Quitar «${p.clave}»`;
    this.quitarEl.setAttribute("aria-label", `Quitar la propiedad ${p.clave}`);
    this.claveEl.setAttribute("aria-label", `Nombre de la propiedad ${p.clave}`);
    if (document.activeElement !== this.claveEl) this.claveEl.value = p.clave;
    this.pintarValor();
  }

  /** Ejecuta una acción que puede lanzar y deja el motivo a la vista si lanza. */
  private intentar(accion: () => void) {
    try {
      accion();
      this.onError(null);
    } catch (e) {
      this.onError(e instanceof Error ? e.message : "No se pudo editar la propiedad.");
    }
  }

  // ── Valor ──────────────────────────────────────────────────────────────────

  private pintarValor() {
    // Lo que tiene el foco no se toca: repintarlo es perder lo que se escribe.
    if (this.editor && document.activeElement === this.editor) return;
    this.editor = null;
    const p = this.p;

    if (p.tipo === "casilla") {
      // La casilla se REUSA si ya está: reemplazarla le sacaría el foco a quien
      // la acaba de marcar con la barra espaciadora.
      const previa = this.valorEl.querySelector<HTMLInputElement>("input.mic-prop-check");
      if (previa) {
        previa.checked = p.valor === true;
        previa.setAttribute("aria-label", p.clave);
        return;
      }
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.className = "mic-prop-check";
      casilla.checked = p.valor === true;
      casilla.setAttribute("aria-label", p.clave);
      casilla.addEventListener("change", () =>
        this.intentar(() => this.acciones.poner(this.p.clave, casilla.checked, "casilla")),
      );
      this.valorEl.replaceChildren(casilla);
      return;
    }

    if (p.tipo === "lista") {
      this.valorEl.replaceChildren(...this.pillsDeLista());
      return;
    }

    const render = document.createElement("span");
    render.className = "mic-prop-render";
    render.tabIndex = 0;
    render.setAttribute("role", "textbox");
    render.setAttribute("aria-label", p.clave);
    render.innerHTML = valorPropiedadHtml(p);
    render.addEventListener("focus", () => this.abrirEditor());
    this.valorEl.replaceChildren(render);
  }

  /** Pasa el valor a `<input>` del tipo que corresponda y toma el foco. */
  private abrirEditor() {
    if (this.editor) return;
    const p = this.p;
    const input = document.createElement("input");
    input.className = "mic-prop-input";
    input.type = tipoDeInput(p.tipo);
    input.value = valorComoTexto(p);
    input.setAttribute("aria-label", p.clave);
    this.editor = input;
    this.valorEl.replaceChildren(input);
    input.focus();
    if (input.type === "text") input.select();
    input.addEventListener("blur", () => this.confirmarValor(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.confirmarValor(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.editor = null;
        this.pintarValor();
        this.enfocarRender();
        this.acciones.medir();
      }
    });
    this.acciones.medir();
  }

  /** Escribe el valor del editor abierto y vuelve al render. */
  private confirmarValor(volverAlRender: boolean) {
    const input = this.editor;
    if (!input) return;
    // Antes de escribir: el dispatch vuelve por `sincronizar()` y no debe
    // encontrarse un editor abierto que ya no lo está.
    this.editor = null;
    const texto = input.value;

    if (texto !== valorComoTexto(this.p)) {
      const clave = this.p.clave;
      if (texto === "") this.intentar(() => this.acciones.poner(clave, "", "texto"));
      else if (this.p.tipo === "numero") {
        const n = Number(texto);
        const valido = Number.isFinite(n) && texto.trim() !== "";
        this.intentar(() => this.acciones.poner(clave, valido ? n : texto, valido ? "numero" : "texto"));
      } else this.intentar(() => this.acciones.poner(clave, texto, this.p.tipo));
    }

    this.pintarValor();
    if (volverAlRender) this.enfocarRender();
    this.acciones.medir();
  }

  private enfocarRender() {
    const render = this.valorEl.querySelector<HTMLElement>(".mic-prop-render");
    render?.focus();
  }

  // ── Listas ─────────────────────────────────────────────────────────────────

  /** Una pastilla por elemento (con su ×) más el `+` para agregar. */
  private pillsDeLista(): HTMLElement[] {
    const p = this.p;
    const items = Array.isArray(p.valor) ? p.valor : [];
    const nodos = items.map((item, i) => {
      const wrap = document.createElement("span");
      wrap.className = "mic-prop-item";
      // El mismo HTML que la vista de lectura (etiqueta, wikilink, pastilla):
      // se le pasa una lista de UN elemento para no duplicar el render.
      wrap.innerHTML = valorPropiedadHtml({ ...p, valor: [item] });
      const quitar = boton("mic-prop-btn mic-prop-btn-mini", "×", `Quitar «${item}»`);
      quitar.addEventListener("click", () =>
        this.intentar(() =>
          this.acciones.poner(this.p.clave, items.filter((_, j) => j !== i), "lista"),
        ),
      );
      wrap.append(quitar);
      return wrap;
    });

    const agregar = boton("mic-prop-btn mic-prop-add-item", "+", `Agregar un elemento a «${p.clave}»`);
    agregar.addEventListener("click", () => this.abrirItemNuevo());
    nodos.push(agregar);
    return nodos;
  }

  /** Campo para agregar un elemento a la lista, en el lugar del botón `+`. */
  private abrirItemNuevo() {
    const btn = this.valorEl.querySelector<HTMLElement>(".mic-prop-add-item");
    if (!btn) return;
    const input = document.createElement("input");
    input.className = "mic-prop-input mic-prop-item-input";
    input.type = "text";
    input.setAttribute("aria-label", `Agregar un elemento a ${this.p.clave}`);
    // Es el editor abierto de la fila: así un repintado no se lo lleva por delante.
    this.editor = input;
    btn.replaceWith(input);
    input.focus();
    this.acciones.medir();

    const confirmar = (seguir: boolean) => {
      const item = input.value.trim();
      input.value = "";
      // Antes de escribir: el dispatch vuelve por `sincronizar()` y tiene que
      // poder repintar las pastillas.
      if (this.editor === input) this.editor = null;
      if (item !== "") {
        const previos = Array.isArray(this.p.valor) ? this.p.valor.map(String) : [];
        this.intentar(() => this.acciones.poner(this.p.clave, [...previos, item], "lista"));
        // El dispatch repinta la fila entera; el `+` vuelve a estar donde estaba.
        if (seguir) this.abrirItemNuevo();
        return;
      }
      this.pintarValor();
      this.acciones.medir();
    };

    input.addEventListener("blur", () => confirmar(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmar(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = "";
        if (this.editor === input) this.editor = null;
        this.pintarValor();
        this.acciones.medir();
      }
    });
  }
}

/**
 * La tarjeta completa: filas + pie (agregar propiedad y «editar como texto»).
 * Se construye UNA vez por widget y se parchea con `sincronizar()`.
 */
export class TarjetaPropiedades {
  readonly dom: HTMLElement;
  private readonly tarjetaEl: HTMLElement;
  private readonly avisoEl: HTMLElement;
  private readonly filasEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly agregarEl: HTMLElement;
  private readonly nuevaEl: HTMLInputElement;
  private readonly tipoEl: HTMLSelectElement;
  private filas: Fila[] = [];
  private avisoPintado = "";

  // Las acciones se atan a UNA vista y no cambian: el DOM de un widget nunca
  // pasa de un CodeMirror a otro (dos vistas de la misma nota tienen cada una
  // su widget, y se sincronizan por el documento vía `docBroker`).
  constructor(private readonly acciones: AccionesPropiedades) {
    this.dom = document.createElement("div");
    this.dom.className = "mic-preview mic-live-props";
    (this.dom as ConControl)[CONTROL] = this;

    this.tarjetaEl = document.createElement("div");
    this.tarjetaEl.className = "mic-props mic-props-edit";

    this.avisoEl = document.createElement("div");
    this.avisoEl.className = "mic-props-nosop";
    this.avisoEl.hidden = true;

    this.filasEl = document.createElement("div");
    this.filasEl.className = "mic-props-filas";

    this.errorEl = document.createElement("p");
    this.errorEl.className = "mic-props-error";
    this.errorEl.hidden = true;

    // Pie: agregar una propiedad + la salida a editar el bloque como texto.
    const pie = document.createElement("div");
    pie.className = "mic-props-pie";

    this.agregarEl = document.createElement("span");
    this.agregarEl.className = "mic-props-agregar";
    this.nuevaEl = document.createElement("input");
    this.nuevaEl.className = "mic-props-nueva";
    this.nuevaEl.type = "text";
    this.nuevaEl.placeholder = "Nueva propiedad";
    this.nuevaEl.setAttribute("aria-label", "Nombre de la propiedad nueva");
    this.tipoEl = document.createElement("select");
    this.tipoEl.className = "mic-props-tipo";
    this.tipoEl.setAttribute("aria-label", "Tipo de la propiedad nueva");
    for (const tipo of TIPOS_PROPIEDAD) {
      const opcion = document.createElement("option");
      opcion.value = tipo;
      opcion.textContent = `${ICONO_TIPO[tipo]} ${NOMBRE_TIPO[tipo]}`;
      this.tipoEl.append(opcion);
    }
    const btnAgregar = boton("mic-props-btn", "+ Agregar propiedad", "Agregar propiedad");
    btnAgregar.addEventListener("click", () => this.agregar());
    this.nuevaEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.agregar();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.nuevaEl.value = "";
      }
    });
    this.agregarEl.append(this.nuevaEl, this.tipoEl, btnAgregar);

    const btnTexto = boton(
      "mic-props-btn mic-props-texto",
      "Editar como texto",
      "Editar el bloque como texto",
    );
    btnTexto.addEventListener("click", () => this.acciones.verComoTexto());

    pie.append(this.agregarEl, btnTexto);
    this.tarjetaEl.append(this.avisoEl, this.filasEl, this.errorEl, pie);
    this.dom.append(this.tarjetaEl);

    // Los enlaces de la tarjeta (wikilinks, `#tag:`) navegan en la vista de
    // lectura, no acá: dentro del editor un href `#…` cambiaría la URL del
    // workspace.
    this.dom.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a")) event.preventDefault();
    });
  }

  /** Refleja el frontmatter de `texto` parcheando el DOM que ya existe. */
  sincronizar(texto: string) {
    const fm = separarFrontmatter(texto);
    const noSoportado = fm.hay && !fm.soportado;

    // Lo que Mycelium no entiende se muestra CRUDO y sin controles, con el
    // motivo a la vista: reescribirlo sería romperle el YAML a alguien. La
    // guarda que lanza sigue en `lib/frontmatter.ts`; esto es solo la UI.
    const huella = noSoportado ? `${fm.motivo} ${fm.crudo}` : "";
    if (huella !== this.avisoPintado) {
      this.avisoPintado = huella;
      this.avisoEl.hidden = !noSoportado;
      this.avisoEl.replaceChildren();
      if (noSoportado) {
        const aviso = document.createElement("p");
        aviso.className = "mic-props-aviso";
        aviso.textContent = `Mycelium no interpreta este frontmatter: ${fm.motivo}. Se muestra tal cual; usá «Editar como texto» para tocarlo a mano.`;
        const crudo = document.createElement("pre");
        crudo.className = "mic-props-crudo";
        const code = document.createElement("code");
        code.textContent = fm.crudo;
        crudo.append(code);
        this.avisoEl.append(aviso, crudo);
      }
    }
    this.agregarEl.hidden = noSoportado;

    this.reconciliar(fm.hay && fm.soportado ? fm.props : []);
  }

  private mostrarError(mensaje: string | null) {
    this.errorEl.textContent = mensaje ?? "";
    this.errorEl.hidden = mensaje === null;
    this.acciones.medir();
  }

  private agregar() {
    const clave = this.nuevaEl.value.trim();
    if (clave === "") return;
    const tipo = this.tipoEl.value as TipoPropiedad;
    try {
      this.acciones.poner(clave, valorInicialDe(tipo), tipo);
      this.mostrarError(null);
      this.nuevaEl.value = "";
      this.nuevaEl.focus();
    } catch (e) {
      this.mostrarError(e instanceof Error ? e.message : "No se pudo agregar la propiedad.");
    }
  }

  /**
   * Empareja las filas del DOM con las propiedades del documento reusando el
   * nodo que ya existe (por clave y, si no, por posición: un renombrado no debe
   * tirar la fila). Solo se mueve lo que de verdad cambió de lugar.
   */
  private reconciliar(props: Propiedad[]) {
    const anteriores = this.filas;
    const porClave = new Map(anteriores.map((f) => [f.clave.toLowerCase(), f]));
    const claves = new Set(props.map((p) => p.clave.toLowerCase()));
    const usadas = new Set<Fila>();
    const nuevas: Fila[] = [];

    props.forEach((p, i) => {
      let fila = porClave.get(p.clave.toLowerCase());
      if (fila && usadas.has(fila)) fila = undefined;
      if (!fila) {
        // Misma posición y su clave ya no está en el documento → es la fila que
        // acaban de renombrar: se reusa en vez de crear una nueva.
        const candidata = anteriores[i];
        if (candidata && !usadas.has(candidata) && !claves.has(candidata.clave.toLowerCase())) {
          fila = candidata;
        }
      }
      if (!fila) fila = new Fila(this.acciones, (m) => this.mostrarError(m), p);
      usadas.add(fila);
      fila.actualizar(p);
      nuevas.push(fila);
    });

    for (const vieja of anteriores) if (!usadas.has(vieja)) vieja.el.remove();
    nuevas.forEach((fila, i) => {
      if (this.filasEl.children[i] !== fila.el) {
        this.filasEl.insertBefore(fila.el, this.filasEl.children[i] ?? null);
      }
    });
    this.filas = nuevas;
  }
}
