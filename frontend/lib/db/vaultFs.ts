/**
 * Puente entre los repos (`lib/db/*`) y las mutaciones de disco del vault en
 * carpeta (fase 4). Reúne:
 *   - envoltorios de los comandos Rust de `vault_fs.rs` (invoke perezoso, para no
 *     romper los tests headless: solo se importa `@tauri-apps/api/core` cuando de
 *     verdad hay un vault activo);
 *   - helpers de ruta POSIX (basename, extensión, unión, saneo mínimo);
 *   - `rekeyIndice`: recodifica en el índice el id (=ruta) de notas y carpetas
 *     cuando un renombrado/movido cambia la identidad, respetando las claves
 *     foráneas (sqlx activa `foreign_keys=ON`), por eso NO se hace `UPDATE` del
 *     PK: se inserta la fila nueva, se repuntan los hijos y se borra la vieja.
 *
 * Todo esto vive aparte para que `notas.ts`/`carpetas.ts`/`papelera.ts`/
 * `contenido.ts` compartan la misma lógica sin duplicarla.
 */
import { execute, select } from "./client";
import { ahoraIso } from "./util";

// ── Envoltorios de los comandos Rust (invoke perezoso) ────────────────────────

/** Carga perezosa de `invoke` (igual patrón que `indexer.ts`). */
async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/** Escritura atómica de una nota en disco (`<vault>/<rutaRel>`). */
export async function escribirNota(vault: string, rutaRel: string, contenido: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("escribir_nota", { vaultRuta: vault, rutaRel, contenido });
}

/** Renombra/mueve un archivo o carpeta dentro del vault. */
export async function moverRuta(vault: string, origenRel: string, destinoRel: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("mover_ruta", { vaultRuta: vault, origenRel, destinoRel });
}

/** Crea un directorio (y ancestros) dentro del vault. */
export async function crearDirectorio(vault: string, rutaRel: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("crear_directorio", { vaultRuta: vault, rutaRel });
}

/** Copia un archivo dentro del vault (duplicar). */
export async function copiarArchivo(vault: string, origenRel: string, destinoRel: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("copiar_archivo", { vaultRuta: vault, origenRel, destinoRel });
}

/** Mueve a la papelera; devuelve la ruta relativa dentro del vault donde quedó. */
export async function borrarAPapelera(vault: string, rutaRel: string): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("borrar_a_papelera", { vaultRuta: vault, rutaRel });
}

/** Restaura de la papelera a `destinoRel`. */
export async function restaurarDePapelera(
  vault: string,
  rutaPapeleraRel: string,
  destinoRel: string,
): Promise<void> {
  const invoke = await getInvoke();
  await invoke("restaurar_de_papelera", { vaultRuta: vault, rutaPapeleraRel, destinoRel });
}

/** Borra definitivamente un elemento de la papelera. */
export async function borrarDefinitivo(vault: string, rutaPapeleraRel: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("borrar_definitivo", { vaultRuta: vault, rutaPapeleraRel });
}

// ── Helpers de ruta POSIX ─────────────────────────────────────────────────────

/** Nombre de archivo (con extensión) de una ruta POSIX. */
export function basenameDe(ruta: string): string {
  return ruta.slice(ruta.lastIndexOf("/") + 1);
}

/** Extensión con punto (`.md`, `.excalidraw`) de una ruta, o "" si no tiene. */
export function extDe(ruta: string): string {
  const nombre = basenameDe(ruta);
  const i = nombre.lastIndexOf(".");
  return i <= 0 ? "" : nombre.slice(i);
}

/** Extensión de archivo según el tipo de nota. */
export function extDeTipo(tipo: string): string {
  return tipo === "excalidraw" ? ".excalidraw" : ".md";
}

/** Une carpeta (id/ruta POSIX o null=raíz) y nombre en una ruta relativa. */
export function unir(carpeta: string | null, nombre: string): string {
  return carpeta ? `${carpeta}/${nombre}` : nombre;
}

/**
 * Saneo MÍNIMO de un nombre de archivo/carpeta (el endurecido completo —nombres
 * reservados de Windows, longitud, colisiones— es fase 7). Sustituye los
 * caracteres prohibidos por el SO (`\ / : * ? " < > |`) por un espacio y recorta
 * puntos/espacios finales (Windows los rechaza). Nunca devuelve cadena vacía.
 */
export function sanearNombre(nombre: string): string {
  const limpio = nombre
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return limpio.length > 0 ? limpio : "Sin título";
}

// ── Recodificación de ids en el índice (identidad = ruta) ─────────────────────

/** Nota a recodificar: su id nuevo, carpeta nueva y título nuevo. */
export type NotaRekey = {
  oldId: string;
  newId: string;
  newCarpetaId: string | null;
  newTitulo: string;
};

/** Carpeta a recodificar: id nuevo, padre nuevo y nombre. */
export type CarpetaRekey = {
  oldId: string;
  newId: string;
  newPadreId: string | null;
  nombre: string;
};

/** Profundidad (nº de segmentos) de una ruta POSIX, para ordenar padres→hijos. */
function profundidad(ruta: string): number {
  return ruta.split("/").length;
}

/**
 * Recodifica en el índice el id (=ruta) de un conjunto de carpetas y notas tras
 * un renombrado/movido en disco. Como `notas.id`/`carpetas.id` son PK con hijos
 * que las referencian por FK (`ON DELETE CASCADE`) y SQLite no ofrece
 * `ON UPDATE CASCADE`, NO se actualiza el PK: se inserta la fila con el id nuevo,
 * se repuntan los hijos al id nuevo y se borra la fila vieja. Orden:
 *   1. carpetas nuevas (menos profundas primero: el padre existe antes que el hijo),
 *   2. notas nuevas (su carpeta ya existe),
 *   3. repunte de contenido/diagramas/papelera + reindex FTS al id nuevo,
 *   4. borrado de notas viejas,
 *   5. borrado de carpetas viejas (el CASCADE limpia descendientes ya vacíos).
 */
export async function rekeyIndice(
  carpetas: CarpetaRekey[],
  notas: NotaRekey[],
): Promise<void> {
  const now = ahoraIso();

  // 1) Carpetas nuevas (copiando vault_id/creado_en de la vieja), padres primero.
  const carpetasAsc = [...carpetas].sort((a, b) => profundidad(a.newId) - profundidad(b.newId));
  for (const c of carpetasAsc) {
    await execute(
      `INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en)
       SELECT ?, vault_id, ?, ?, creado_en, ? FROM carpetas WHERE id = ?`,
      [c.newId, c.newPadreId, c.nombre, now, c.oldId],
    );
  }

  // 2) Notas nuevas (copiando tipo/tamaño/mtime/creado_en de la vieja).
  for (const n of notas) {
    await execute(
      `INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, creado_en, actualizado_en)
       SELECT ?, vault_id, ?, ?, tipo, tamano_bytes, mtime, creado_en, ? FROM notas WHERE id = ?`,
      [n.newId, n.newCarpetaId, n.newTitulo, now, n.oldId],
    );
  }

  // 3) Repunte de hijos + reindex FTS (delete viejo + insert nuevo con el título).
  for (const n of notas) {
    const cont = await select<{ contenido: string }>(
      "SELECT contenido FROM contenidos WHERE nota_id = ?",
      [n.oldId],
    );
    await execute("UPDATE contenidos SET nota_id = ? WHERE nota_id = ?", [n.newId, n.oldId]);
    await execute("UPDATE diagramas SET nota_id = ? WHERE nota_id = ?", [n.newId, n.oldId]);
    await execute("UPDATE papelera SET nota_id = ? WHERE nota_id = ?", [n.newId, n.oldId]);
    await execute("DELETE FROM notas_fts WHERE nota_id = ?", [n.oldId]);
    await execute("INSERT INTO notas_fts (nota_id, titulo, contenido) VALUES (?, ?, ?)", [
      n.newId,
      n.newTitulo,
      cont[0]?.contenido ?? "",
    ]);
  }

  // 4) Borrado de notas viejas (ya sin hijos que las referencien).
  for (const n of notas) {
    await execute("DELETE FROM notas WHERE id = ?", [n.oldId]);
  }

  // 5) Borrado de carpetas viejas (más profundas primero; el CASCADE cubre el resto).
  const carpetasDesc = [...carpetas].sort((a, b) => profundidad(b.oldId) - profundidad(a.oldId));
  for (const c of carpetasDesc) {
    await execute("DELETE FROM carpetas WHERE id = ?", [c.oldId]);
  }
}
