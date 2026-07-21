/**
 * CRUD de carpetas (HU-22/24). Portado de `VaultRepository` + la orquestación de
 * `VaultEndpoints` (anti-ciclo al mover, borrado recursivo con notas a papelera).
 */
import { execute, select } from "./client";
import { DbError } from "./errors";
import { carpetaDeArchivo } from "./indexer";
import type { CreatedResponse } from "./types";
import { ahoraIso, buildRutaLookup, nuevoId, rutaDe } from "./util";
import { getVaultActual } from "./vaultContext";
import {
  basenameDe,
  borrarAPapelera,
  crearDirectorio,
  moverRuta,
  nombreCarpetaLibre,
  rekeyIndice,
  rutaOcupada,
  sanearNombre,
  unir,
  type CarpetaRekey,
  type NotaRekey,
} from "./vaultFs";

/** Ids de la carpeta y todas sus descendientes (CTE recursiva). */
async function subtreeIds(carpetaId: string): Promise<string[]> {
  const rows = await select<{ id: string }>(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM carpetas WHERE id = ?
       UNION ALL
       SELECT c.id FROM carpetas c JOIN sub s ON c.padre_id = s.id
     )
     SELECT id FROM sub`,
    [carpetaId],
  );
  return rows.map((r) => r.id);
}

async function vaultIdOfCarpeta(carpetaId: string): Promise<string | null> {
  const rows = await select<{ vault_id: string }>(
    "SELECT vault_id FROM carpetas WHERE id = ?",
    [carpetaId],
  );
  return rows.length > 0 ? rows[0].vault_id : null;
}

/**
 * Sustituye el prefijo `viejo` de una ruta POSIX por `nuevo`. La propia carpeta
 * (`ruta === viejo`) y sus descendientes (`viejo/...`) quedan bajo `nuevo`.
 */
function reemplazarPrefijo(ruta: string, viejo: string, nuevo: string): string {
  if (ruta === viejo) return nuevo;
  if (ruta.startsWith(`${viejo}/`)) return nuevo + ruta.slice(viejo.length);
  return ruta;
}

/**
 * Recodifica en el índice el subárbol de una carpeta (todas sus subcarpetas y
 * notas) tras moverla/renombrarla en disco de `oldPath` a `newPath`. Construye
 * los mapas de rekey reemplazando el prefijo y delega en `rekeyIndice`.
 * `nombreRaiz` es el nombre visible de la carpeta movida (cambia al renombrar).
 */
async function reindexarSubarbol(
  oldPath: string,
  newPath: string,
  nombreRaiz: string,
  nuevoPadreRaiz: string | null,
): Promise<void> {
  const ids = await subtreeIds(oldPath);
  const carpetasFilas = await select<{ id: string; padre_id: string | null; nombre: string }>(
    `SELECT id, padre_id, nombre FROM carpetas WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  const carpetas: CarpetaRekey[] = carpetasFilas.map((c) => ({
    oldId: c.id,
    newId: reemplazarPrefijo(c.id, oldPath, newPath),
    // La raíz del subárbol cuelga del nuevo padre; las hijas siguen a su padre remapeado.
    newPadreId:
      c.id === oldPath
        ? nuevoPadreRaiz
        : c.padre_id === null
          ? null
          : reemplazarPrefijo(c.padre_id, oldPath, newPath),
    nombre: c.id === oldPath ? nombreRaiz : c.nombre,
  }));

  const notasFilas = await select<{ id: string; carpeta_id: string | null; titulo: string }>(
    `SELECT id, carpeta_id, titulo FROM notas WHERE carpeta_id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  const notas: NotaRekey[] = notasFilas.map((n) => ({
    oldId: n.id,
    newId: reemplazarPrefijo(n.id, oldPath, newPath),
    newCarpetaId:
      n.carpeta_id === null ? null : reemplazarPrefijo(n.carpeta_id, oldPath, newPath),
    newTitulo: n.titulo,
  }));

  await rekeyIndice(carpetas, notas);
}

/** `POST /vaults/{id}/carpetas`. Sin sufijo único (paridad con el backend). */
export async function crearCarpeta(
  vaultId: string,
  padreId: string | null,
  nombre: string,
): Promise<CreatedResponse> {
  const limpio = nombre.trim();
  if (limpio.length === 0) throw new DbError(400, "El nombre no puede estar vacío.");
  const now = ahoraIso();

  const vault = getVaultActual();
  if (vault !== null) {
    // Modo carpeta: la identidad es la ruta; se crea el directorio real. Se sanea
    // y se desambigua con sufijo incremental si ya existe otra carpeta/nota con
    // ese nombre en el mismo padre (estilo Obsidian: "Carpeta", "Carpeta 1"…).
    const { id, nombre: nombreFs } = await nombreCarpetaLibre(padreId, limpio);
    await crearDirectorio(vault, id);
    await execute(
      "INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      [id, vaultId, padreId, nombreFs, now, now],
    );
    return { id };
  }

  const id = nuevoId();
  await execute(
    "INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)",
    [id, vaultId, padreId, limpio, now, now],
  );
  return { id };
}

/**
 * `PATCH /carpetas/{id}` (renombrar). En modo carpeta cambia la ruta (id) de la
 * carpeta y de TODO su subárbol; se devuelve el id NUEVO. En clásico, el mismo id.
 */
export async function renombrarCarpeta(id: string, nombre: string): Promise<CreatedResponse> {
  const limpio = nombre.trim();
  if (limpio.length === 0) throw new DbError(400, "El nombre no puede estar vacío.");

  const vault = getVaultActual();
  if (vault !== null) {
    const existe = await vaultIdOfCarpeta(id);
    if (existe === null) throw new DbError(404, "La carpeta no existe.");
    const padre = carpetaDeArchivo(id); // carpeta padre (o null en raíz)
    const nombreFs = sanearNombre(limpio, "Sin nombre");
    const newId = unir(padre, nombreFs);
    if (newId !== id) {
      if (await rutaOcupada(newId, id)) {
        throw new DbError(409, "Ya existe una carpeta o nota con ese nombre aquí.");
      }
      await moverRuta(vault, id, newId);
      await reindexarSubarbol(id, newId, nombreFs, padre);
    }
    return { id: newId };
  }

  await execute("UPDATE carpetas SET nombre = ?, actualizado_en = ? WHERE id = ?", [
    limpio,
    ahoraIso(),
    id,
  ]);
  return { id };
}

/**
 * `POST /carpetas/{id}/mover`. Valida anti-ciclo y mismo vault. En modo carpeta
 * la ruta (id) de la carpeta y su subárbol cambia; se devuelve el id NUEVO.
 */
export async function moverCarpeta(
  id: string,
  destinoId: string | null,
): Promise<CreatedResponse> {
  if (destinoId !== null) {
    const subtree = await subtreeIds(id);
    if (subtree.includes(destinoId)) {
      throw new DbError(400, "No se puede mover una carpeta dentro de sí misma ni de sus hijos.");
    }
    const [vaultDestino, vaultOrigen] = await Promise.all([
      vaultIdOfCarpeta(destinoId),
      vaultIdOfCarpeta(id),
    ]);
    if (vaultDestino !== vaultOrigen) {
      throw new DbError(400, "El destino no pertenece al mismo vault.");
    }
  }

  const vault = getVaultActual();
  if (vault !== null) {
    const nombre = basenameDe(id); // el nombre no cambia al mover
    const newId = unir(destinoId, nombre);
    if (newId !== id) {
      if (await rutaOcupada(newId, id)) {
        throw new DbError(409, "Ya existe una carpeta o nota con ese nombre en el destino.");
      }
      await moverRuta(vault, id, newId);
      await reindexarSubarbol(id, newId, nombre, destinoId);
    }
    return { id: newId };
  }

  await execute("UPDATE carpetas SET padre_id = ?, actualizado_en = ? WHERE id = ?", [
    destinoId,
    ahoraIso(),
    id,
  ]);
  return { id };
}

/**
 * `DELETE /carpetas/{id}`: las notas del subárbol (no ya en papelera) van a la
 * papelera con su ruta original; el subárbol de carpetas se borra en cascada.
 */
export async function borrarCarpeta(id: string): Promise<void> {
  const vaultId = await vaultIdOfCarpeta(id);
  if (vaultId === null) throw new DbError(404, "La carpeta no existe.");

  const subtree = await subtreeIds(id);
  const placeholders = subtree.map(() => "?").join(", ");
  const notas =
    subtree.length === 0
      ? []
      : await select<{ id: string; carpeta_id: string | null }>(
          `SELECT id, carpeta_id FROM notas
           WHERE carpeta_id IN (${placeholders}) AND id NOT IN (SELECT nota_id FROM papelera)`,
          subtree,
        );

  const todas = await select<{ id: string; padre_id: string | null; nombre: string }>(
    "SELECT id, padre_id, nombre FROM carpetas WHERE vault_id = ?",
    [vaultId],
  );
  const rutas = buildRutaLookup(todas);

  const now = ahoraIso();
  const vault = getVaultActual();

  // Modo carpeta: se mueve la carpeta ENTERA a la papelera de disco. Cada nota
  // recibe su ruta dentro de la papelera (prefijo de la carpeta + resto de su id)
  // para poder restaurarla individualmente.
  let trashCarpetaRel: string | null = null;
  if (vault !== null) {
    trashCarpetaRel = await borrarAPapelera(vault, id);
  }

  for (const n of notas) {
    if (trashCarpetaRel !== null) {
      // Modo carpeta: la columna `ruta_papelera` (extra del índice) guarda dónde
      // quedó el archivo en disco para poder restaurarlo.
      await execute(
        "INSERT OR IGNORE INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en, ruta_papelera) VALUES (?, ?, ?, ?, ?, ?)",
        [nuevoId(), n.id, rutaDe(rutas, n.carpeta_id), n.carpeta_id, now, trashCarpetaRel + n.id.slice(id.length)],
      );
    } else {
      await execute(
        "INSERT OR IGNORE INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES (?, ?, ?, ?, ?)",
        [nuevoId(), n.id, rutaDe(rutas, n.carpeta_id), n.carpeta_id, now],
      );
    }
  }
  // ON DELETE CASCADE borra las carpetas hijas; las notas quedan (carpeta_id → NULL)
  // pero ya están en papelera, así que el árbol no las muestra.
  await execute("DELETE FROM carpetas WHERE id = ?", [id]);
}
