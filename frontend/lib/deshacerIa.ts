/**
 * El **Deshacer** del registro de actividad de la IA (`FUN-L-09`), para las tres
 * familias de operaciones: el calendario (Parte 2, `lib/mcpCalendario.ts`), los
 * archivos (Parte 3, `lib/mcpArchivos.ts`) y el diccionario del vault (Parte 4,
 * `lib/mcpDiccionario.ts`). El panel le pregunta acá qué
 * dice el botón, si se puede —y si no, por qué: «cambió después»— y lo
 * deshace.
 */
import { useActividadIaStore } from "@/stores/actividadIaStore";
import type { DeshacerIa, Entrada } from "@/lib/actividadIa";
import {
  describirDeshacerArchivos,
  puedeDeshacerArchivos,
  type DeshacerArchivos,
  type EstadoVault,
} from "@/lib/mcpArchivosLogica";
import { describirDeshacer, puedeDeshacer, type DeshacerCalendario } from "@/lib/mcpCalendarioLogica";
import {
  describirDeshacerDiccionario,
  puedeDeshacerDiccionario,
  type DeshacerDiccionario,
} from "@/lib/mcpDiccionarioLogica";
import type { ArchivoRecordatorios } from "@/lib/recordatorios";

export function esDeArchivos(d: DeshacerIa): d is DeshacerArchivos {
  return d.tipo.startsWith("archivo_");
}

export function esDelDiccionario(d: DeshacerIa): d is DeshacerDiccionario {
  return d.tipo.startsWith("diccionario_");
}

/** Qué hace el botón, en palabras. */
export function describir(d: DeshacerIa): string {
  if (esDelDiccionario(d)) return describirDeshacerDiccionario(d);
  return esDeArchivos(d) ? describirDeshacerArchivos(d) : describirDeshacer(d as DeshacerCalendario);
}

/**
 * Por qué ya no se puede deshacer, o `null` si se puede. Contra lo que hay
 * hoy: el calendario, el vault o el diccionario del vault (`null` mientras no
 * se leyó: se ofrece, y la escritura vuelve a comprobarlo). Si lo que dejó la
 * operación cambió después, deshacer pisaría ese cambio, y no se ofrece.
 */
export function motivoSinDeshacer(
  d: DeshacerIa,
  calendario: ArchivoRecordatorios,
  vault: EstadoVault,
  diccionario: ReadonlySet<string> | null = null,
): string | null {
  if (esDelDiccionario(d)) {
    if (diccionario === null) return null;
    const r = puedeDeshacerDiccionario(diccionario, d);
    return r.ok ? null : r.porque;
  }
  const r = esDeArchivos(d) ? puedeDeshacerArchivos(vault, d) : puedeDeshacer(calendario, d as DeshacerCalendario);
  return r.ok ? null : r.porque;
}

/**
 * Deshace la operación de una entrada y deja constancia (una entrada
 * `deshacer` que apunta a la original: el registro es *append-only*).
 * Devuelve el texto para el aviso.
 */
export async function deshacerEntrada(e: Entrada): Promise<{ ok: boolean; texto: string }> {
  if (!e.deshacer) return { ok: false, texto: "Esto no se puede deshacer." };
  try {
    let texto: string;
    if (esDelDiccionario(e.deshacer)) {
      const { deshacerDiccionario } = await import("@/lib/mcpDiccionario");
      texto = await deshacerDiccionario(e.deshacer);
    } else if (esDeArchivos(e.deshacer)) {
      const { deshacerArchivos } = await import("@/lib/mcpArchivos");
      texto = await deshacerArchivos(e.deshacer);
    } else {
      const { deshacer } = await import("@/lib/mcpCalendario");
      texto = deshacer(e.deshacer as DeshacerCalendario);
    }
    useActividadIaStore.getState().registrar({ op: "deshacer", ref: e.id, resultado: "hecho", efecto: texto });
    return { ok: true, texto };
  } catch (err) {
    return { ok: false, texto: err instanceof Error ? err.message : String(err) };
  }
}
