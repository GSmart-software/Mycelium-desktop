/**
 * Corrector ortográfico del editor (`FUN-L-12`), con **motor propio**.
 *
 * Primero se usó el corrector del sistema, pero Edge/WebView2 solo revisa lo
 * que se tipea: una nota abierta no mostraba ningún error hasta editar cada
 * renglón (spec § H5). Ahora las palabras las revisa spellbook, en un worker
 * (`lib/ortografia/corrector.ts`), con diccionarios Hunspell que el usuario
 * descarga. Ver `docs/features/corrector-ortografico.md`.
 *
 * Lo que hace esta extensión:
 *
 *   1. **Apaga el del sistema** siempre (`spellcheck="false"`), para que no haya
 *      dos subrayados.
 *   2. **Revisa lo visible** —con un margen— ~300 ms después de escribir o de
 *      desplazarse, y enseguida al abrir la nota: extrae las palabras, descarta
 *      las que caen en lo que no es prosa (`rangosExcluidos`) y le pregunta al
 *      worker solo por las únicas que el caché no conoce.
 *   3. **Subraya** las mal escritas (`.mic-error-ortografico`).
 *   4. **Menú propio** al hacer clic derecho sobre una marca: sugerencias,
 *      «Agregar al diccionario del vault» e «Ignorar». Sobre cualquier otra cosa,
 *      el menú de siempre.
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { getAllViews } from "@/lib/editor/viewRegistry";
import { rangosExcluidos } from "@/lib/editor/ortografiaExclusiones";
import * as corrector from "@/lib/ortografia/corrector";
import { vaultActual } from "@/lib/ortografia/diccionarios";
import { extraerPalabras, fueraDeExcluidos, normalizarPalabra, type Palabra } from "@/lib/ortografia/palabras";
import type { MenuItem } from "@/components/explorer/ContextMenu";

/** Espera tras escribir o desplazarse antes de revisar. */
const ESPERA_MS = 300;
/**
 * Caracteres que se revisan antes y después de lo visible: desplazarse un poco
 * no deja palabras sin marcar mientras corre la espera. Con ~5.000 palabras en
 * 25 ms en el worker, revisar de más cuesta poco; y el caché hace que lo ya visto
 * no vuelva a viajar.
 */
const MARGEN = 3000;

const marca = Decoration.mark({ class: "mic-error-ortografico" });

/** Transacción vacía que solo avisa «llegaron respuestas: redibujá». */
const redibujar = StateEffect.define<null>();

/** Lo visible, con el margen, fundido en rangos que no se pisan. */
function rangosARevisar(view: EditorView): { from: number; to: number }[] {
  const largo = view.state.doc.length;
  const rangos: { from: number; to: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const r = { from: Math.max(0, from - MARGEN), to: Math.min(largo, to + MARGEN) };
    const ultimo = rangos[rangos.length - 1];
    if (ultimo && r.from <= ultimo.to) ultimo.to = Math.max(ultimo.to, r.to);
    else rangos.push(r);
  }
  return rangos;
}

/** Las palabras de lo que se revisa, sin las excluidas, con su forma normalizada. */
function palabrasARevisar(view: EditorView): (Palabra & { clave: string })[] {
  const rangos = rangosARevisar(view);
  const excluidos = rangosExcluidos(view.state, rangos);
  const doc = view.state.doc;
  const lista: (Palabra & { clave: string })[] = [];
  for (const { from, to } of rangos) {
    const palabras = fueraDeExcluidos(extraerPalabras(doc.sliceString(from, to), from), excluidos);
    for (const p of palabras) lista.push({ ...p, clave: normalizarPalabra(p.texto) });
  }
  return lista;
}

class Revisor implements PluginValue {
  decorations: DecorationSet = Decoration.none;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private readonly baja: () => void;
  private encendido = false;
  private destruido = false;

  constructor(
    private readonly view: EditorView,
    private readonly activo: () => boolean,
  ) {
    // Cuando el worker contesta, o se vacía el caché (un diccionario nuevo, una
    // palabra agregada), se vuelve a revisar enseguida: lo que falte se pide y
    // lo que ya se sabe se dibuja.
    this.baja = corrector.suscribir(() => this.programar(0));
    this.sincronizar();
  }

  /** Prende o apaga según la preferencia. Devuelve si está activo. */
  private sincronizar(): boolean {
    const activo = this.activo();
    if (activo && !this.encendido) {
      this.encendido = true;
      corrector.asegurar();
      // Al abrir la nota, lo visible se revisa ya, sin la espera.
      this.programar(0);
    } else if (!activo && this.encendido) {
      this.encendido = false;
      this.cancelar();
      this.decorations = Decoration.none;
      // Apagado con el interruptor: sin worker (criterio 13). La preferencia
      // es una para toda la ventana, así que el primer editor que se entera
      // apaga el corrector de todos.
      if (corrector.encendido()) corrector.apagar();
    }
    return activo;
  }

  update(u: ViewUpdate) {
    if (u.docChanged) {
      // Una marca sobre algo que se acaba de editar se quita ya —la palabra
      // está cambiando— y se vuelve a decidir al dejar de tipear.
      const tocados: [number, number][] = [];
      u.changes.iterChangedRanges((_a, _b, desde, hasta) => tocados.push([desde, hasta]));
      this.decorations = this.decorations.map(u.changes).update({
        filter: (from, to) => !tocados.some(([d, h]) => from <= h && to >= d),
      });
    }
    if (!this.sincronizar()) return;
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.programar(ESPERA_MS);
    }
  }

  private cancelar() {
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
  }

  private programar(ms: number) {
    if (!this.encendido || this.destruido) return;
    this.cancelar();
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      void this.revisar();
    }, ms);
  }

  private async revisar() {
    if (!this.encendido || this.destruido) return;
    const doc = this.view.state.doc;
    const palabras = palabrasARevisar(this.view);
    const faltan = corrector.pendientes(palabras.map((p) => p.clave));
    if (faltan.length > 0) {
      // La respuesta llega por `suscribir` si se guardó; si el corrector se
      // recargó mientras tanto, también avisa. En los dos casos se vuelve a
      // entrar acá y ya no falta nada.
      if (await corrector.revisar(faltan)) this.programar(0);
      return;
    }
    // Si el documento cambió mientras tanto, las posiciones ya no valen: la
    // edición ya programó otra revisión.
    if (this.destruido || this.view.state.doc !== doc) return;
    const builder = new RangeSetBuilder<Decoration>();
    for (const p of palabras) {
      if (corrector.consultar(p.clave) === false) builder.add(p.desde, p.hasta, marca);
    }
    const nuevas = builder.finish();
    if (mismasMarcas(nuevas, this.decorations)) return;
    this.decorations = nuevas;
    this.view.dispatch({ effects: redibujar.of(null) });
  }

  destroy() {
    this.destruido = true;
    this.cancelar();
    this.baja();
  }

  /** La palabra marcada en `pos`, si hay una. */
  marcaEn(pos: number): { desde: number; hasta: number } | null {
    let hallada: { desde: number; hasta: number } | null = null;
    this.decorations.between(pos, pos, (from, to) => {
      hallada = { desde: from, hasta: to };
      return false;
    });
    return hallada;
  }
}

function mismasMarcas(a: DecorationSet, b: DecorationSet): boolean {
  if (a.size !== b.size) return false;
  const ia = a.iter();
  const ib = b.iter();
  while (ia.value && ib.value) {
    if (ia.from !== ib.from || ia.to !== ib.to) return false;
    ia.next();
    ib.next();
  }
  return !ia.value && !ib.value;
}

/** El menú del clic derecho sobre una palabra marcada. */
async function abrirMenu(view: EditorView, desde: number, hasta: number, x: number, y: number) {
  const palabra = view.state.doc.sliceString(desde, hasta);
  const sugerencias = await corrector.sugerir(palabra);
  const hayVault = vaultActual() !== null;
  const items: MenuItem[] = [
    ...(sugerencias.length > 0
      ? sugerencias.map((s) => ({
          label: s,
          onClick: () => {
            // Solo si la palabra sigue ahí: entre el clic y la elección el
            // documento pudo cambiar.
            if (view.state.doc.sliceString(desde, hasta) !== palabra) return;
            view.dispatch({ changes: { from: desde, to: hasta, insert: s }, userEvent: "input.corrector" });
            view.focus();
          },
        }))
      : [{ label: "Sin sugerencias", disabled: true }]),
    {
      label: "Agregar al diccionario del vault",
      disabled: !hayVault,
      title: hayVault
        ? "Deja de marcarla en todas las notas de este vault"
        : "Abrí un vault para tener un diccionario propio",
      onClick: () => {
        corrector.agregarAlVault(palabra).catch((e) => {
          console.error("[Mycelium] corrector · no se pudo guardar la palabra", e);
        });
      },
    },
    {
      label: "Ignorar",
      title: "No la marca más hasta cerrar la app",
      onClick: () => corrector.ignorar(palabra),
    },
  ];
  const { abrirMenuOrtografia } = await import("@/components/editor/MenuOrtografia");
  abrirMenuOrtografia(x, y, items);
}

function crearPlugin(activo: () => boolean) {
  const plugin = ViewPlugin.define((view) => new Revisor(view, activo), {
    decorations: (v) => v.decorations,
    eventHandlers: {
      contextmenu(e: MouseEvent, view: EditorView) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const hallada = this.marcaEn(pos);
        if (!hallada) return false; // el menú de siempre
        e.preventDefault();
        void abrirMenu(view, hallada.desde, hallada.hasta, e.clientX, e.clientY);
        return true;
      },
    },
  });
  return plugin;
}

/**
 * El corrector, encendido o apagado según `activo()`, que se lee en cada
 * actualización de la vista. Al cambiar la preferencia hay que llamar a
 * `refrescarCorrector()` para que las vistas abiertas se enteren sin esperar a
 * que el usuario escriba.
 */
export function correctorOrtografico(activo: () => boolean): Extension {
  return [
    // El del sistema, apagado siempre: el subrayado es el propio.
    EditorView.contentAttributes.of({ spellcheck: "false" }),
    crearPlugin(activo),
  ];
}

/**
 * Aplica ya un cambio de la preferencia a todos los editores abiertos. Al
 * apagarla, además, termina el worker.
 */
export function refrescarCorrector(activo: boolean): void {
  if (!activo) corrector.apagar();
  for (const view of getAllViews()) view.dispatch({});
}
