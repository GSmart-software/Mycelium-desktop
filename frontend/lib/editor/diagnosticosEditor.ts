/**
 * Los diagnósticos de la nota en el editor (`FUN-M-44`), como un linter: un
 * subrayado ondulado en lo que tiene un problema y el mensaje al pasar el
 * mouse. Usa `@codemirror/lint` —ya estaba en el proyecto por el editor de CSS—
 * con `setDiagnostics`, que **no corre nada solo**: acá se decide cuándo.
 *
 * Cuándo: al abrir la nota, al guardarla (`EVENTO_NOTA_GUARDADA`, con el índice
 * ya al día), cuando el vault cambia por fuera (`EVENTO_RECARGA`) o cambia el
 * árbol (crear, renombrar, borrar una nota), cuando se
 * releen los esquemas (`refreshLiveEffect`) y al encender la preferencia.
 * **Nunca en cada tecla.** Entre un cálculo y otro, CodeMirror corre las marcas
 * con lo que se escribe.
 *
 * Con la preferencia apagada (Configuración → Editor) no se calcula nada y se
 * borran las marcas.
 */
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Diagnostico } from "@/lib/diagnosticos";
import {
  componerDiagnosticos,
  consultarParaDiagnosticos,
  diagnosticosEncendidos,
  marcarAbierta,
  olvidarDiagnosticos,
  renombrarAbierta,
} from "@/lib/diagnosticosVault";
import { EVENTO_NOTA_GUARDADA, EVENTO_RECARGA } from "@/lib/eventos";
import { refreshLiveEffect } from "@/lib/editor/livePreview";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Espera tras abrir: que termine de montarse la vista y de cargar el contenido. */
const AL_ABRIR_MS = 400;
/** Espera tras un evento (guardado, cambio externo, esquemas): junta ráfagas. */
const TRAS_EVENTO_MS = 250;
/** Espera tras un cambio del árbol: el índice tarda un poco más en ponerse al día. */
const TRAS_ARBOL_MS = 900;

/** Un diagnóstico puro → el de CodeMirror, acotado al documento. */
function aCodeMirror(d: Diagnostico, largo: number): Diagnostic {
  const from = Math.min(Math.max(0, d.desde), largo);
  const to = Math.min(Math.max(from, d.hasta), largo);
  return { from, to, severity: "warning", source: "Mycelium", message: d.mensaje, markClass: "mic-diagnostico" };
}

/**
 * La extensión del editor de notas. `notaId` se lee por referencia: la vista se
 * crea una vez y la nota puede renombrarse sin que la extensión se reconfigure.
 */
export function diagnosticosEditor(notaId: () => string): Extension {
  return ViewPlugin.fromClass(
    class {
      private id: string;
      private timer: ReturnType<typeof setTimeout> | null = null;
      private vivo = true;
      private turno = 0;
      private readonly soltar: (() => void)[] = [];

      constructor(private readonly view: EditorView) {
        this.id = notaId();
        marcarAbierta(this.id, true);
        this.programar(AL_ABRIR_MS);

        const alGuardar = (e: Event) => {
          if ((e as CustomEvent<{ notaId?: string }>).detail?.notaId === this.idActual()) this.programar(TRAS_EVENTO_MS);
        };
        const alRecargar = () => this.programar(TRAS_EVENTO_MS);
        window.addEventListener(EVENTO_NOTA_GUARDADA, alGuardar);
        window.addEventListener(EVENTO_RECARGA, alRecargar);
        this.soltar.push(() => window.removeEventListener(EVENTO_NOTA_GUARDADA, alGuardar));
        this.soltar.push(() => window.removeEventListener(EVENTO_RECARGA, alRecargar));
        // Crear, renombrar o borrar una nota desde la app cambia qué enlaces
        // resuelven en ESTA (un enlace roto deja de estarlo al crear su nota).
        this.soltar.push(
          useVaultStore.subscribe((s, previo) => {
            if (s.notas !== previo.notas) this.programar(TRAS_ARBOL_MS);
          }),
        );
        this.soltar.push(
          usePreferencesStore.subscribe((s, previo) => {
            if (s.prefs.diagnosticosEditor !== previo.prefs.diagnosticosEditor) this.programar(0);
          }),
        );
      }

      /** El id de la nota ahora (un renombre lo cambia sin recrear la vista). */
      private idActual(): string {
        const actual = notaId();
        if (actual !== this.id) {
          renombrarAbierta(this.id, actual);
          this.id = actual;
        }
        return actual;
      }

      update(u: ViewUpdate) {
        if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLiveEffect)))) this.programar(TRAS_EVENTO_MS);
      }

      private programar(ms: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.calcular();
        }, ms);
      }

      private async calcular() {
        const turno = ++this.turno;
        const id = this.idActual();
        if (!diagnosticosEncendidos()) {
          olvidarDiagnosticos(id);
          this.aplicar([]);
          return;
        }
        try {
          const informe = await consultarParaDiagnosticos(id);
          // Otro cálculo empezó después, o la vista se cerró: este ya no vale.
          if (!this.vivo || turno !== this.turno || id !== this.idActual()) return;
          // El texto de AHORA: si se escribió mientras se consultaba el índice,
          // los enlaces se buscan donde están, no donde estaban.
          const texto = this.view.state.doc.toString();
          this.aplicar(componerDiagnosticos(id, texto, informe));
        } catch (e) {
          // Un fallo del índice no debe molestar al que escribe: se registra y
          // se deja lo que había.
          console.warn("[Mycelium] no se pudieron calcular los diagnósticos de", id, e);
        }
      }

      private aplicar(ds: Diagnostico[]) {
        if (!this.vivo) return;
        const largo = this.view.state.doc.length;
        this.view.dispatch(setDiagnostics(this.view.state, ds.map((d) => aCodeMirror(d, largo))));
      }

      destroy() {
        this.vivo = false;
        if (this.timer) clearTimeout(this.timer);
        for (const s of this.soltar) s();
        marcarAbierta(this.id, false);
      }
    },
  );
}
