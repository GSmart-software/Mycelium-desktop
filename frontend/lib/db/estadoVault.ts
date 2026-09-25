/**
 * Lo que el índice guardaba y NO se deriva de ningún archivo (`DEF-107`).
 *
 * El índice (`index-<hash>.db`) se presenta como un caché reconstruible, pero
 * tres de sus tablas no lo eran: la apariencia (`usuarios`: tema, modo oscuro,
 * `preferencias_json`), los snippets CSS (`css_snippets`) y el registro de la
 * papelera (`papelera`). Borrar el índice para reconstruirlo —el remedio obvio
 * ante un índice roto, y el único que había— los perdía sin aviso.
 *
 * Ahora la verdad vive en `.mycelium/` dentro del vault, junto a la papelera de
 * disco y a `preferencias.json` (`FUN-M-28`), y viaja con él:
 *
 *   - `apariencia.json`, `snippets.json`, `papelera.json`.
 *
 * Las tablas siguen existiendo —el resto de la capa de datos las lee como
 * siempre—, pero son una COPIA:
 *
 *   - cada cambio en ellas se **respalda** en su archivo (`respaldar*`);
 *   - al abrir el vault, `restaurarEstadoVault` **rellena** las tablas desde los
 *     archivos. Si un archivo todavía no existe —un índice de antes de este
 *     cambio—, se escribe a partir de la tabla: esa es la migración, y es lo que
 *     protege a quien actualiza con datos que hoy solo están en el índice.
 *
 * Solo aplica con un vault en carpeta (`getVaultActual()`); sin vault no hay
 * `.mycelium/` donde escribir.
 */
import { LOCAL_VAULT_ID } from "./auth";
import { execute, select } from "./client";
import { getVaultActual } from "./vaultContext";

type Nombre = "apariencia.json" | "snippets.json" | "papelera.json";

/** Versión del formato de los tres archivos, por si cambia su forma. */
const VERSION = 1;

type Apariencia = {
  version: number;
  tema: string;
  modoOscuro: boolean;
  preferencias: unknown;
};

type SnippetGuardado = {
  id: string;
  nombre: string;
  activo: boolean;
  contenido: string;
  creadoEn: string;
};

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

async function leer<T>(vault: string, nombre: Nombre): Promise<T | null> {
  const texto = await invocar<string | null>("leer_estado_vault", { ruta: vault, nombre });
  if (texto === null) return null;
  try {
    return JSON.parse(texto) as T;
  } catch (e) {
    // Un archivo corrupto no debe impedir abrir el vault: se sigue con lo que
    // tenga el índice, y el próximo respaldo lo reescribe entero.
    console.error(`[Mycelium] estado · ${nombre} no es JSON válido; se ignora`, e);
    return null;
  }
}

async function escribir(vault: string, nombre: Nombre, datos: unknown): Promise<void> {
  await invocar("escribir_estado_vault", {
    ruta: vault,
    nombre,
    contenido: JSON.stringify(datos, null, 2),
  });
}

/**
 * Corre un respaldo sin que su fallo tumbe la operación que lo pidió: el cambio
 * ya está en el índice y el usuario lo ve. Pero no en silencio —si el archivo no
 * se escribe, ese cambio es justo el que se perdería al reconstruir—.
 */
async function respaldar(nombre: Nombre, fn: (vault: string) => Promise<void>): Promise<void> {
  const vault = getVaultActual();
  if (vault === null) return;
  try {
    await fn(vault);
  } catch (e) {
    console.error(`[Mycelium] estado · no se pudo respaldar ${nombre} en .mycelium/`, e);
  }
}

// ── Leer las tablas ─────────────────────────────────────────────────────────

async function aparienciaDelIndice(): Promise<Apariencia | null> {
  const filas = await select<{ tema: string; modo_oscuro: number; preferencias_json: string | null }>(
    "SELECT tema, modo_oscuro, preferencias_json FROM usuarios LIMIT 1",
  );
  if (filas.length === 0) return null;
  const f = filas[0];
  let preferencias: unknown = null;
  try {
    preferencias = f.preferencias_json ? JSON.parse(f.preferencias_json) : null;
  } catch {
    // esperado: un `preferencias_json` ilegible se respalda como `null`, igual
    // que lo trata la app al leerlo.
  }
  return { version: VERSION, tema: f.tema, modoOscuro: f.modo_oscuro === 1, preferencias };
}

async function snippetsDelIndice(): Promise<SnippetGuardado[]> {
  const filas = await select<{ id: string; nombre: string; activo: number; contenido: string; creado_en: string }>(
    "SELECT id, nombre, activo, contenido, creado_en FROM css_snippets ORDER BY creado_en",
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    activo: f.activo === 1,
    contenido: f.contenido,
    creadoEn: f.creado_en,
  }));
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

// ── Respaldar (índice → archivo) ────────────────────────────────────────────

/** Tras cambiar el tema, el modo o las preferencias. */
export const respaldarApariencia = () =>
  respaldar("apariencia.json", async (vault) => {
    const a = await aparienciaDelIndice();
    if (a) await escribir(vault, "apariencia.json", a);
  });

/** Tras crear, editar o borrar un snippet. */
export const respaldarSnippets = () =>
  respaldar("snippets.json", async (vault) =>
    escribir(vault, "snippets.json", { version: VERSION, snippets: await snippetsDelIndice() }),
  );

/** Tras mandar a la papelera, recuperar, borrar para siempre o purgar. */
export const respaldarPapelera = () =>
  respaldar("papelera.json", async (vault) =>
    escribir(vault, "papelera.json", { version: VERSION, entradas: await papeleraDelIndice() }),
  );

// ── Restaurar (archivo → índice) ────────────────────────────────────────────

/**
 * Rellena las tres tablas desde `.mycelium/`, o escribe los archivos si todavía
 * no existen. Va DESPUÉS de `indexarVault`: la papelera necesita las carpetas
 * del índice para saber si la carpeta original de cada nota sigue existiendo.
 */
export async function restaurarEstadoVault(vault: string): Promise<void> {
  const usuario = await select<{ id: string }>("SELECT id FROM usuarios LIMIT 1");
  const uid = usuario[0]?.id;

  // Apariencia.
  const apariencia = await leer<Apariencia>(vault, "apariencia.json");
  if (apariencia === null) {
    const a = await aparienciaDelIndice();
    if (a) await escribir(vault, "apariencia.json", a);
  } else if (uid) {
    await execute(
      "UPDATE usuarios SET tema = ?, modo_oscuro = ?, preferencias_json = ? WHERE id = ?",
      [
        apariencia.tema,
        apariencia.modoOscuro ? 1 : 0,
        apariencia.preferencias === null || apariencia.preferencias === undefined
          ? null
          : JSON.stringify(apariencia.preferencias),
        uid,
      ],
    );
  }

  // Snippets: el archivo manda; la tabla queda igual a él.
  const snippets = await leer<{ snippets: SnippetGuardado[] }>(vault, "snippets.json");
  if (snippets === null) {
    await escribir(vault, "snippets.json", { version: VERSION, snippets: await snippetsDelIndice() });
  } else if (uid) {
    await execute("DELETE FROM css_snippets");
    for (const s of snippets.snippets ?? []) {
      await execute(
        "INSERT INTO css_snippets (id, usuario_id, nombre, activo, contenido, creado_en) VALUES (?, ?, ?, ?, ?, ?)",
        [s.id, uid, s.nombre, s.activo ? 1 : 0, s.contenido, s.creadoEn],
      );
    }
  }

  // Papelera: cada entrada necesita su fila en `notas` (la lista y la
  // recuperación leen el título de ahí). En un índice recién reconstruido esa
  // fila no existe —el archivo está en `.mycelium/.trash`, que no se indexa—,
  // así que se crea. Su carpeta original solo se enlaza si sigue existiendo.
  const papelera = await leer<{ entradas: EntradaPapelera[] }>(vault, "papelera.json");
  if (papelera === null) {
    await escribir(vault, "papelera.json", { version: VERSION, entradas: await papeleraDelIndice() });
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
