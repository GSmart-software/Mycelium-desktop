/**
 * Los diagnósticos de las notas abiertas (`FUN-M-44`): los calcula con la
 * salud de la nota (`lib/saludVault.ts`, sobre el índice) y sus avisos de
 * propiedades (`lib/esquemasVault.ts`, sobre el texto del editor), y los guarda
 * por nota para que los lean el editor, la barra de estado y
 * `mycelium_diagnosticos` **sin recalcular**. La lógica pura está en
 * `lib/diagnosticos.ts`; el enganche con CodeMirror, en
 * `lib/editor/diagnosticosEditor.ts`.
 *
 * Se calcula al abrir una nota y al guardarla (con el índice ya al día), nunca
 * en cada tecla. Solo desktop.
 */
import { useSyncExternalStore } from "react";
import { diagnosticosDeNota, type Diagnostico } from "@/lib/diagnosticos";
import { asegurarEsquemas, avisosDeNota } from "@/lib/esquemasVault";
import { informeDeSalud } from "@/lib/saludVault";
import type { InformeSalud } from "@/lib/salud";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** Lo calculado para una nota. */
export type DiagnosticosDeNota = {
  diagnosticos: Diagnostico[];
  /** Cuándo (ms). */
  calculadoEn: number;
};

const porNota = new Map<string, DiagnosticosDeNota>();
/** Cuántas vistas tienen abierta cada nota: al cerrar la última, se olvida. */
const abiertas = new Map<string, number>();
const oyentes = new Set<() => void>();
let version = 0;

function emitir() {
  version++;
  for (const o of oyentes) o();
}

/** ¿Están encendidos los diagnósticos (Configuración → Editor)? */
export function diagnosticosEncendidos(): boolean {
  return usePreferencesStore.getState().prefs.diagnosticosEditor !== false;
}

/** Lo que ya está calculado de una nota, o `undefined`. */
export function diagnosticosDe(notaId: string): DiagnosticosDeNota | undefined {
  return porNota.get(notaId);
}

/** Las notas abiertas en algún editor, con lo calculado de cada una (si hay). */
export function diagnosticosAbiertos(): { notaId: string; calculado: DiagnosticosDeNota | undefined }[] {
  return [...abiertas.keys()].sort().map((notaId) => ({ notaId, calculado: porNota.get(notaId) }));
}

/** Una vista abrió (o cerró) la nota. */
export function marcarAbierta(notaId: string, abierta: boolean): void {
  const n = (abiertas.get(notaId) ?? 0) + (abierta ? 1 : -1);
  if (n > 0) abiertas.set(notaId, n);
  else {
    abiertas.delete(notaId);
    if (porNota.delete(notaId)) emitir();
  }
}

/** La nota cambió de id (renombre): lo calculado la acompaña. */
export function renombrarAbierta(antes: string, despues: string): void {
  if (antes === despues) return;
  marcarAbierta(antes, false);
  marcarAbierta(despues, true);
}

/** Olvida lo calculado de una nota (al apagar los diagnósticos). */
export function olvidarDiagnosticos(notaId: string): void {
  if (porNota.delete(notaId)) emitir();
}

/**
 * Lo que hace falta del índice para los diagnósticos de una nota: su informe de
 * salud (alcance = la nota) y los esquemas leídos. Va aparte de
 * `componerDiagnosticos` para poder recomponer con el texto actual del editor
 * si el usuario escribió mientras se consultaba el índice.
 */
export async function consultarParaDiagnosticos(notaId: string): Promise<InformeSalud> {
  await asegurarEsquemas();
  return informeDeSalud({ tipo: "nota", ruta: notaId });
}

/** Los diagnósticos de una nota con este texto y este informe, y los guarda. */
export function componerDiagnosticos(notaId: string, texto: string, informe: InformeSalud): Diagnostico[] {
  const diagnosticos = diagnosticosDeNota({
    notaId,
    texto,
    rotos: informe.rotos,
    embedsRotos: informe.embedsRotos,
    duplicados: informe.duplicados,
    propiedades: avisosDeNota(notaId, texto),
  });
  porNota.set(notaId, { diagnosticos, calculadoEn: Date.now() });
  emitir();
  return diagnosticos;
}

function suscribir(o: () => void): () => void {
  oyentes.add(o);
  return () => oyentes.delete(o);
}

/** Los diagnósticos de una nota, para un componente (`undefined` = sin calcular). */
export function useDiagnosticos(notaId: string | null): DiagnosticosDeNota | undefined {
  useSyncExternalStore(
    suscribir,
    () => version,
    () => 0,
  );
  return notaId ? porNota.get(notaId) : undefined;
}
