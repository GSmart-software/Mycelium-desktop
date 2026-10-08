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
import { EXTENSION_POR_TIPO } from "@/lib/extensionesDeTipo";
import { execute, select } from "./client";
import { reResolverTitulos } from "./enlacesIndice";
import { enTandas, ftsBorrar, ftsPoner, marcadores } from "./ftsIndice";
import { crearCola, desambiguar, sanearNombre } from "./nombres";
import { ahoraIso } from "./util";

// Re-exporta el saneo puro (definido sin dependencias en `nombres.ts`) para que
// los repos sigan importándolo desde `vaultFs` como hasta ahora.
export { desambiguar, esReservadoWindows, sanearNombre } from "./nombres";

// ── Envoltorios de los comandos Rust (invoke perezoso) ────────────────────────

/** Carga perezosa de `invoke` (igual patrón que `indexer.ts`). */
async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/**
 * Escrituras hechas por la propia app, `ruta relativa → mtime` con que quedó el
 * archivo (`FUN-M-38`, hallazgo H3; amplía `FUN-M-14`). Cada guardado dispara
 * el watcher nativo, y hasta ahora ese evento costaba un reindexado incremental
 * completo, una recarga del árbol y dos escaneos del grafo —para una nota que
 * la app acababa de escribir y ya tenía al día—. `lib/vaultWatch.ts` compara el
 * `mtime` que trae el evento con el anotado acá: si coinciden, no fue nadie
 * de afuera. Si un editor externo pisa el archivo en ese lapso, su `mtime` es
 * otro y se reindexa como siempre.
 *
 * Las entradas caducan solas: pasado `VIGENCIA_ESCRITURA_MS` un `mtime` igual
 * ya no prueba nada, y así el mapa no crece con la sesión.
 */
const escriturasPropias = new Map<string, { mtime: number; en: number }>();
const VIGENCIA_ESCRITURA_MS = 60_000;

function anotarEscrituraPropia(rutaRel: string, mtime: number): void {
  const ahora = Date.now();
  if (escriturasPropias.size >= 256) {
    for (const [ruta, e] of escriturasPropias) {
      if (ahora - e.en > VIGENCIA_ESCRITURA_MS) escriturasPropias.delete(ruta);
    }
  }
  escriturasPropias.set(rutaRel, { mtime, en: ahora });
}

/**
 * ¿Este cambio que reporta el watcher lo escribió la propia app? Solo si la
 * ruta se anotó hace poco y el archivo sigue con el `mtime` de esa escritura.
 * Un `mtime` de 0 (el SO no lo expone) nunca prueba nada.
 */
export function esEscrituraPropia(rutaRel: string, mtime: number): boolean {
  const e = escriturasPropias.get(rutaRel);
  return (
    e !== undefined &&
    mtime !== 0 &&
    e.mtime === mtime &&
    Date.now() - e.en <= VIGENCIA_ESCRITURA_MS
  );
}

/**
 * Escritura atómica de una nota en disco (`<vault>/<rutaRel>`). Devuelve el
 * `mtime` (ms epoch) con que quedó el archivo —el mismo que verá el recorrido
 * del índice—, para guardarlo en `notas.mtime` y que el reindexado incremental
 * no vuelva a leer una nota que la app acaba de escribir.
 */
export async function escribirNota(vault: string, rutaRel: string, contenido: string): Promise<number> {
  const invoke = await getInvoke();
  const mtime = await invoke<number>("escribir_nota", { vaultRuta: vault, rutaRel, contenido });
  anotarEscrituraPropia(rutaRel, mtime);
  return mtime;
}

/** Abre el explorador del SO mostrando el archivo/carpeta `rutaRel` del vault. */
export async function revelarEnSistema(vault: string, rutaRel: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("revelar_en_sistema", { vaultRuta: vault, rutaRel });
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

/**
 * Lee un archivo de texto del vault, o `null` si no existe. Sirve también para
 * lo que está fuera del índice (`.claude/`, `.mycelium/`), que es donde viven el
 * léxico y los respaldos del re-enlazado (`FUN-M-17`).
 */
export async function leerArchivoTexto(vault: string, rutaRel: string): Promise<string | null> {
  const invoke = await getInvoke();
  return invoke<string | null>("leer_archivo_texto", { vaultRuta: vault, rutaRel });
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

/** Extensión con punto (`.md`, `.excalidraw`, `.base`) de una ruta, o "" si no tiene. */
export function extDe(ruta: string): string {
  const nombre = basenameDe(ruta);
  const i = nombre.lastIndexOf(".");
  return i <= 0 ? "" : nombre.slice(i);
}

/**
 * Extensión de archivo según el tipo de nota, con punto.
 *
 * El mapa vive en `lib/extensionesDeTipo`: es la misma pregunta que contestan el
 * explorador (para mostrar el nombre con extensión) y la resolución de
 * wikilinks, y tenerla tres veces fue justo cómo `.drawio` quedó a medias.
 */
export function extDeTipo(tipo: string): string {
  const ext = (EXTENSION_POR_TIPO as Record<string, string | undefined>)[tipo];
  return `.${ext ?? "md"}`;
}

/** Une carpeta (id/ruta POSIX o null=raíz) y nombre en una ruta relativa. */
export function unir(carpeta: string | null, nombre: string): string {
  return carpeta ? `${carpeta}/${nombre}` : nombre;
}

// ── Colisiones de nombre en la misma carpeta (fase 7) ─────────────────────────

/**
 * Elegir un nombre libre y ocuparlo es UN paso (`DEF-136`): quien crea algo
 * nuevo en el vault (`crearNota`, `duplicarNota`, `crearCarpeta`) llama a
 * `nombreNotaLibre`/`nombreCarpetaLibre`, escribe en disco y hace el `INSERT`
 * dentro de `conNombreReservado`. Sin la cola, dos creaciones seguidas elegían
 * el mismo nombre (el índice todavía no tenía la primera) y la segunda fallaba
 * con un choque de clave, después de pisar el archivo de la primera.
 */
export const conNombreReservado = crearCola();

/**
 * Basenames (nombre de archivo con extensión + nombres de carpeta) ya ocupados
 * dentro de `carpetaId` (o la raíz si es `null`) según el ÍNDICE. Sirve para
 * desambiguar al crear/duplicar sin pisar un archivo real (dos entradas con el
 * mismo basename son imposibles en disco). Excluye notas ya en la papelera.
 */
async function basenamesOcupados(carpetaId: string | null): Promise<Set<string>> {
  // Las notas de la PAPELERA cuentan como ocupadas (DEF-046). Su `id` —que es su
  // ruta original— sigue en la tabla `notas` para poder recuperarlas, así que
  // reutilizar ese nombre reventaba el `INSERT` de `crearNota` con un choque de
  // clave y salía como "error desconocido". Además, si el nombre se reutilizara,
  // recuperar la de la papelera después chocaría contra la nueva.
  const notas =
    carpetaId === null
      ? await select<{ id: string }>("SELECT id FROM notas WHERE carpeta_id IS NULL")
      : await select<{ id: string }>("SELECT id FROM notas WHERE carpeta_id = ?", [carpetaId]);
  const carpetas =
    carpetaId === null
      ? await select<{ id: string }>("SELECT id FROM carpetas WHERE padre_id IS NULL")
      : await select<{ id: string }>("SELECT id FROM carpetas WHERE padre_id = ?", [carpetaId]);

  const set = new Set<string>();
  for (const n of notas) set.add(basenameDe(n.id));
  for (const c of carpetas) set.add(basenameDe(c.id));
  return set;
}

/**
 * Calcula un nombre de archivo libre para una nota nueva/duplicada en `carpetaId`.
 * Sanea `baseTitulo`, y si el basename (`<stem><ext>`) ya existe en la carpeta,
 * añade sufijo incremental (" 1", " 2"…, estilo Obsidian). Devuelve el `id` (ruta
 * relativa) y el `titulo` (= stem saneado y desambiguado, que en modo carpeta
 * coincide con el nombre del archivo).
 */
export async function nombreNotaLibre(
  carpetaId: string | null,
  baseTitulo: string,
  ext: string,
): Promise<{ id: string; titulo: string }> {
  const ocupados = await basenamesOcupados(carpetaId);
  const base = sanearNombre(baseTitulo);
  const stem = desambiguar(base, (cand) => ocupados.has(cand + ext) || ocupados.has(cand));
  return { id: unir(carpetaId, stem + ext), titulo: stem };
}

/**
 * Calcula un nombre de directorio libre para una carpeta nueva bajo `padreId`.
 * Igual que `nombreNotaLibre` pero sin extensión y con fallback "Sin nombre".
 */
export async function nombreCarpetaLibre(
  padreId: string | null,
  baseNombre: string,
): Promise<{ id: string; nombre: string }> {
  const ocupados = await basenamesOcupados(padreId);
  const base = sanearNombre(baseNombre, "Sin nombre");
  const nombre = desambiguar(base, (cand) => ocupados.has(cand));
  return { id: unir(padreId, nombre), nombre };
}

/**
 * Comprueba si `destinoId` (ruta relativa POSIX) ya está ocupado en el índice por
 * una nota o una carpeta DISTINTA de `origenId`. Se usa antes de renombrar/mover
 * en modo carpeta para RECHAZAR la colisión (en vez de pisar). La comparación es
 * exacta sobre la ruta; un renombrado que solo cambia mayúsculas/minúsculas
 * (`Nota.md` → `nota.md`) NO se considera colisión (ids distintos, mismo archivo).
 */
export async function rutaOcupada(destinoId: string, origenId: string): Promise<boolean> {
  if (destinoId === origenId) return false;
  const nota = await select<{ id: string }>("SELECT id FROM notas WHERE id = ?", [destinoId]);
  if (nota.length > 0) return true;
  const carpeta = await select<{ id: string }>("SELECT id FROM carpetas WHERE id = ?", [destinoId]);
  return carpeta.length > 0;
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
 *   3. repunte de contenido/papelera/propiedades/enlaces/etiquetas + reindex
 *      FTS al id nuevo,
 *   4. borrado de notas viejas,
 *   5. borrado de carpetas viejas (el CASCADE limpia descendientes ya vacíos),
 *   6. re-resolución dirigida de los enlaces (`FUN-L-25`): los títulos viejos y
 *      nuevos de las notas movidas, porque cambió qué nota se llama así o su
 *      ruta (la pista de carpeta y el desempate por profundidad dependen de ella).
 */
export async function rekeyIndice(
  carpetas: CarpetaRekey[],
  notas: NotaRekey[],
): Promise<void> {
  const now = ahoraIso();

  // Los títulos de antes, para la re-resolución del final (paso 6).
  const titulosViejos: string[] = [];
  for (const tanda of enTandas(notas.map((n) => n.oldId))) {
    const filas = await select<{ titulo: string }>(
      `SELECT titulo FROM notas WHERE id IN (${marcadores(tanda.length)})`,
      tanda,
    );
    for (const f of filas) titulosViejos.push(f.titulo);
  }

  // 1) Carpetas nuevas (copiando vault_id/creado_en de la vieja), padres primero.
  const carpetasAsc = [...carpetas].sort((a, b) => profundidad(a.newId) - profundidad(b.newId));
  for (const c of carpetasAsc) {
    await execute(
      `INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en)
       SELECT ?, vault_id, ?, ?, creado_en, ? FROM carpetas WHERE id = ?`,
      [c.newId, c.newPadreId, c.nombre, now, c.oldId],
    );
  }

  // 2) Notas nuevas (copiando tipo/tamaño/mtime/creado_en de la vieja). La
  // huella de los enlaces también: sus filas se repuntan tal cual (paso 3). La
  // de lo indexable NO: `ftsPoner` de abajo indexa el texto crudo, y con la
  // huella en NULL el próximo guardado la vuelve a indexar bien.
  for (const n of notas) {
    await execute(
      `INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, hash_enlaces, creado_en, actualizado_en)
       SELECT ?, vault_id, ?, ?, tipo, tamano_bytes, mtime, hash_enlaces, creado_en, ? FROM notas WHERE id = ?`,
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
    await execute("UPDATE papelera SET nota_id = ? WHERE nota_id = ?", [n.newId, n.oldId]);
    // Las propiedades se perdían acá: el `DELETE` de la nota vieja (paso 4) las
    // borraba en cascada, y como el `mtime` se copia, el reindexado no las
    // volvía a leer hasta que el archivo cambiara.
    await execute("UPDATE propiedades SET nota_id = ? WHERE nota_id = ?", [n.newId, n.oldId]);
    // Enlaces (`FUN-L-25`): los que salen de la nota y los que llegan a ella.
    await execute("UPDATE enlaces SET desde_id = ? WHERE desde_id = ?", [n.newId, n.oldId]);
    await execute("UPDATE enlaces SET destino_id = ? WHERE destino_id = ?", [n.newId, n.oldId]);
    await execute("UPDATE etiquetas SET nota_id = ? WHERE nota_id = ?", [n.newId, n.oldId]);
    await ftsBorrar([n.oldId]);
    await ftsPoner(n.newId, n.newTitulo, cont[0]?.contenido ?? "");
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

  // 6) Re-resolución dirigida (`FUN-L-25`). El repunte del paso 3 deja cada
  // enlace entrante en el id nuevo, que es lo correcto si todavía resuelve ahí;
  // esto corrige los que no: `[[Viejo]]` tras renombrar a «Nuevo» pasa a su
  // homónima o a roto, y un `[[Nuevo]]` que estaba roto pasa a resolver.
  if (notas.length > 0) await reResolverTitulos([...titulosViejos, ...notas.map((n) => n.newTitulo)]);
}

