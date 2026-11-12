/**
 * Los recordatorios **personales** sobre el disco (`FUN-M-60`): un archivo fuera
 * de todo vault, en la carpeta de datos de la app, junto a la Bandeja personal.
 * El mismo desde todos los vaults y todas las ventanas, con el mismo formato que
 * `.mycelium/recordatorios.json`.
 *
 * Se habla con él solo por comandos de Rust acotados a ESE archivo
 * (`src-tauri/src/recordatorios_personales.rs`), que no reciben rutas. Cambiar
 * algo es leer, aplicar el cambio a lo leído y guardar con la huella de lo
 * leído; si otra ventana escribió en el medio, Rust no escribe y se reintenta
 * sobre lo nuevo. Así dos ventanas que completan, posponen o crean a la vez no
 * se pisan. Cada escritura avisa a todas las ventanas
 * (`recordatorios-personales-cambiados`), que recargan.
 */
import { huellaDeTexto } from "@/lib/conflictoExterno";
import { archivoVacio, leerArchivo, type ArchivoRecordatorios } from "@/lib/recordatorios";

/** Cuántas veces se reintenta si el archivo cambia entre leer y escribir. */
const REINTENTOS = 5;

/** El evento de Rust cuando la app escribió el archivo (cualquier ventana). */
const EVENTO_RUST = "recordatorios-personales-cambiados";

async function invocar<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Lo leído: el archivo interpretado, o `null` si está dañado (y entonces no se escribe). */
export type LeidoPersonal = { texto: string; archivo: ArchivoRecordatorios | null; ruta: string };

/**
 * Lee el archivo. Sin él, vacío. Con una forma que no se entiende, `archivo:
 * null`: quien lo lee NO debe sobrescribirlo, como con el del vault.
 */
export async function leerPersonales(): Promise<LeidoPersonal> {
  const r = await invocar<{ contenido: string; existe: boolean; ruta: string }>("recordatorios_personales_leer");
  if (!r.existe || r.contenido.trim() === "") return { texto: r.contenido, archivo: archivoVacio(), ruta: r.ruta };
  let json: unknown = null;
  try {
    json = JSON.parse(r.contenido);
  } catch {
    // esperado: el `null` de abajo lo trata como dañado.
  }
  return { texto: r.contenido, archivo: leerArchivo(json), ruta: r.ruta };
}

/** El archivo está dañado: no se escribe para no perder lo que se pueda recuperar a mano. */
export class PersonalesDanados extends Error {}

/**
 * Aplica `cambio` sobre lo que hay en disco y lo guarda con la huella de lo
 * leído, reintentando si otra ventana escribió en el medio. Devuelve cómo
 * quedó. `cambio` tiene que poder aplicarse otra vez sobre una versión más
 * nueva (es una operación, no un archivo entero).
 */
export async function modificarPersonales(
  cambio: (a: ArchivoRecordatorios) => ArchivoRecordatorios,
): Promise<ArchivoRecordatorios> {
  for (let intento = 0; intento < REINTENTOS; intento++) {
    const leido = await leerPersonales();
    if (leido.archivo === null) throw new PersonalesDanados("Recordatorios personales.json está dañado");
    const nuevo = cambio(leido.archivo);
    const r = await invocar<{ conflicto: boolean }>("recordatorios_personales_guardar", {
      contenido: JSON.stringify(nuevo, null, 2),
      huellaEsperada: await huellaDeTexto(leido.texto),
    });
    if (!r.conflicto) return nuevo;
  }
  throw new Error("Los recordatorios personales cambiaban mientras se guardaba. Vuelve a intentarlo.");
}

/** Escucha los cambios hechos desde cualquier ventana (también esta). Devuelve con qué dejar de escuchar. */
export async function escucharPersonales(alCambiar: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen(EVENTO_RUST, () => alCambiar());
}

/**
 * De estos avisos personales (`clave|momento`), cuáles muestra ESTA ventana:
 * uno personal lo avisa una sola ventana aunque haya varias de vault abiertas
 * (la que tenga el foco, o la primera que pregunta). Fuera de Tauri, todos.
 */
export async function reclamarAvisos(claves: string[]): Promise<string[]> {
  if (claves.length === 0) return [];
  try {
    return await invocar<string[]>("recordatorios_personales_reclamar", { claves });
  } catch (e) {
    console.error("[Mycelium] recordatorios personales · no se pudo repartir los avisos", e);
    return claves;
  }
}
