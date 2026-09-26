/**
 * El registro de la papelera, que el índice guarda y NO se deriva de ningún
 * archivo (`DEF-107`).
 *
 * El índice (`index-<hash>.db`) es un caché reconstruible de los archivos del
 * vault, salvo en una cosa: la tabla `papelera` dice qué nota se borró, de dónde
 * y dónde quedó su archivo en `.mycelium/.trash/`. Borrar el índice para
 * reconstruirlo la perdía sin aviso, y con ella la forma de recuperar esas notas.
 *
 * La verdad vive en `.mycelium/papelera.json`, dentro del vault, y viaja con él.
 * La tabla sigue existiendo —la lista y la recuperación la consultan, y cada
 * entrada necesita su fila en `notas`— pero es una COPIA:
 *
 *   - cada cambio en ella se **respalda** en el archivo (`respaldarPapelera`);
 *   - al abrir el vault, `restaurarEstadoVault` **rellena** la tabla desde el
 *     archivo. Si el archivo todavía no existe —un índice de antes de este
 *     cambio—, se escribe a partir de la tabla: esa es la migración.
 *
 * Lo demás que vive en `.mycelium/` ya no pasa por el índice: las preferencias
 * y la apariencia (`preferencias.json`, `prefsVaultStore`) y los snippets CSS
 * (`snippets.json`, `cssStore`) se leen y escriben directo (`FUN-L-24`).
 */
import { execute, select } from "./client";
import { getVaultActual, LOCAL_VAULT_ID } from "./vaultContext";

/** Versión del formato del archivo, por si cambia su forma. */
const VERSION = 1;

const ARCHIVO = "papelera.json";

type EntradaPapelera = {
  id: string;
  notaId: string;
  titulo: string;
  tipo: string;
  rutaOriginal: string;
  carpetaOriginalId: string | null;
  eliminadoEn: string;
  rutaPapelera: string | null;
};

async function invocar<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function leer(vault: string): Promise<{ entradas?: EntradaPapelera[] } | null> {
  const texto = await invocar<string | null>("leer_estado_vault", { ruta: vault, nombre: ARCHIVO });
  if (texto === null) return null;
  try {
    return JSON.parse(texto) as { entradas?: EntradaPapelera[] };
  } catch (e) {
    // Un archivo corrupto no debe impedir abrir el vault: se sigue con lo que
    // tenga el índice, y el próximo respaldo lo reescribe entero.
    console.error(`[Mycelium] estado · ${ARCHIVO} no es JSON válido; se ignora`, e);
    return null;
  }
}

async function escribir(vault: string): Promise<void> {
  await invocar("escribir_estado_vault", {
    ruta: vault,
    nombre: ARCHIVO,
    contenido: JSON.stringify({ version: VERSION, entradas: await papeleraDelIndice() }, null, 2),
  });
}

async function papeleraDelIndice(): Promise<EntradaPapelera[]> {
  const filas = await select<{
    id: string;
    nota_id: string;
    titulo: string | null;
    tipo: string | null;
    ruta_original: string;
    carpeta_original_id: string | null;
    eliminado_en: string;
    ruta_papelera: string | null;
  }>(
    `SELECT p.id, p.nota_id, n.titulo, n.tipo, p.ruta_original, p.carpeta_original_id,
            p.eliminado_en, p.ruta_papelera
     FROM papelera p LEFT JOIN notas n ON n.id = p.nota_id
     ORDER BY p.eliminado_en`,
  );
  return filas.map((f) => ({
    id: f.id,
    notaId: f.nota_id,
    titulo: f.titulo ?? f.nota_id.replace(/^.*\//, "").replace(/\.[^.]+$/, ""),
    tipo: f.tipo ?? "markdown",
    rutaOriginal: f.ruta_original,
    carpetaOriginalId: f.carpeta_original_id,
    eliminadoEn: f.eliminado_en,
    rutaPapelera: f.ruta_papelera,
  }));
}

/**
 * Tras mandar a la papelera, recuperar, borrar para siempre o purgar. Su fallo
 * no tumba la operación que lo pidió —el cambio ya está en el índice y el
 * usuario lo ve—, pero no en silencio: si el archivo no se escribe, ese cambio es
 * justo el que se perdería al reconstruir.
 */
export async function respaldarPapelera(): Promise<void> {
  try {
    await escribir(getVaultActual());
  } catch (e) {
    console.error(`[Mycelium] estado · no se pudo respaldar ${ARCHIVO} en .mycelium/`, e);
  }
}

/**
 * Rellena la tabla `papelera` desde `.mycelium/papelera.json`, o escribe el
 * archivo si todavía no existe. Va DESPUÉS de `indexarVault`: necesita las
 * carpetas del índice para saber si la carpeta original de cada nota sigue
 * existiendo.
 */
export async function restaurarEstadoVault(vault: string): Promise<void> {
  // Cada entrada necesita su fila en `notas` (la lista y la recuperación leen el
  // título de ahí). En un índice recién reconstruido esa fila no existe —el
  // archivo está en `.mycelium/.trash`, que no se indexa—, así que se crea. Su
  // carpeta original solo se enlaza si sigue existiendo.
  const papelera = await leer(vault);
  if (papelera === null) {
    await escribir(vault);
    return;
  }
  const carpetas = new Set(
    (await select<{ id: string }>("SELECT id FROM carpetas")).map((c) => c.id),
  );
  const enArchivo = new Set((papelera.entradas ?? []).map((e) => e.notaId));
  for (const e of papelera.entradas ?? []) {
    const carpeta = e.carpetaOriginalId !== null && carpetas.has(e.carpetaOriginalId)
      ? e.carpetaOriginalId
      : null;
    await execute(
      `INSERT OR IGNORE INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [e.notaId, LOCAL_VAULT_ID, carpeta, e.titulo, e.tipo, e.eliminadoEn, e.eliminadoEn],
    );
    await execute(
      `INSERT OR IGNORE INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en, ruta_papelera)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [e.id, e.notaId, e.rutaOriginal, e.carpetaOriginalId, e.eliminadoEn, e.rutaPapelera],
    );
  }
  // Lo que el índice tenga en la papelera y el archivo no: el archivo manda.
  const sobrantes = (await select<{ nota_id: string }>("SELECT nota_id FROM papelera"))
    .map((r) => r.nota_id)
    .filter((id) => !enArchivo.has(id));
  for (const id of sobrantes) {
    await execute("DELETE FROM papelera WHERE nota_id = ?", [id]);
  }
}
