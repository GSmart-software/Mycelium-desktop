/**
 * CRUD de notas (HU-23). Portado de `VaultRepository` + orquestación de
 * `VaultEndpoints` (sufijo único al crear/duplicar, chequeo de mismo vault al mover,
 * copia de contenido al duplicar). La identidad de una nota es su ruta relativa en
 * el vault: cada operación toca primero el disco y después el índice.
 */
import { derivarEnlaces, derivarEtiquetas } from "@/lib/enlacesNota";
import { TITULO_POR_DEFECTO } from "@/lib/extensionesDeTipo";
import { execute, select } from "./client";
import { crearResolutor, escribirEnlacesTanda, huellaEnlaces, reResolverTitulos } from "./enlacesIndice";
import { ftsPoner } from "./ftsIndice";
import { DbError } from "./errors";
import { carpetaDeArchivo, tituloDeRuta } from "./indexer";
import type { CreatedResponse, NotaTipo } from "./types";
import { ahoraIso } from "./util";
import { getVaultActual } from "./vaultContext";
import {
  basenameDe,
  copiarArchivo,
  escribirNota,
  extDe,
  extDeTipo,
  moverRuta,
  nombreNotaLibre,
  rekeyIndice,
  rutaOcupada,
  sanearNombre,
  unir,
} from "./vaultFs";

async function vaultIdOfNota(notaId: string): Promise<string | null> {
  const rows = await select<{ vault_id: string }>("SELECT vault_id FROM notas WHERE id = ?", [
    notaId,
  ]);
  return rows.length > 0 ? rows[0].vault_id : null;
}

async function vaultIdOfCarpeta(carpetaId: string): Promise<string | null> {
  const rows = await select<{ vault_id: string }>("SELECT vault_id FROM carpetas WHERE id = ?", [
    carpetaId,
  ]);
  return rows.length > 0 ? rows[0].vault_id : null;
}

/** `POST /vaults/{id}/notas`. */
export async function crearNota(
  vaultId: string,
  carpetaId: string | null,
  titulo?: string | null,
  tipo?: string | null,
): Promise<CreatedResponse> {
  const t: NotaTipo =
    tipo === "excalidraw" || tipo === "base" || tipo === "canvas" || tipo === "drawio"
      ? tipo
      : "markdown";
  const base = titulo && titulo.trim().length > 0 ? titulo.trim() : TITULO_POR_DEFECTO[t];
  const vault = getVaultActual();
  const now = ahoraIso();

  // La identidad es la ruta. El saneo + desambiguación por sufijo se hace a nivel
  // de NOMBRE DE ARCHIVO (`nombreNotaLibre`), no de título: así se evita pisar un
  // archivo real cuando dos títulos distintos sanean al mismo nombre o cuando ya
  // existe una carpeta con ese nombre. El título mostrado pasa a ser el nombre
  // saneado (como Obsidian). Se crea el archivo vacío.
  const libre = await nombreNotaLibre(carpetaId, base, extDeTipo(t));
  // El `mtime` real del archivo, no `Date.now()` (`FUN-M-38`): si difieren, el
  // próximo reindexado incremental relee la nota recién creada sin motivo.
  const mtime = await escribirNota(vault, libre.id, "");
  await execute(
    "INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
    [libre.id, vaultId, carpetaId, libre.titulo, t, mtime, now, now],
  );
  await execute(
    "INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, '', ?)",
    [libre.id, now],
  );
  await ftsPoner(libre.id, libre.titulo, "");
  // Un `[[enlace]]` que estaba roto hacia este título pasa a resolver ya, sin
  // esperar a reindexar (`FUN-L-25`).
  await reResolverTitulos([libre.titulo]);
  return { id: libre.id };
}

/**
 * `PATCH /notas/{id}` (renombrar). La identidad es la ruta, así que renombrar
 * CAMBIA el id: se devuelve el id NUEVO. No reindexa contenido (no cambió), solo
 * el título.
 *
 * > [!important] Devuelve también el título que el archivo OBTUVO (`DEF-084`)
 * > No es el mismo que el pedido: `sanearNombre` sustituye lo que un nombre de
 * > archivo no admite. Quien reescribe los `[[enlaces]]` entrantes necesita el
 * > que quedó en disco — con el pedido los deja apuntando a una nota que no
 * > existe, y en silencio.
 */
export async function renombrarNota(
  id: string,
  titulo: string,
): Promise<CreatedResponse & { titulo: string }> {
  const limpio = titulo.trim();
  if (limpio.length === 0) throw new DbError(400, "El título no puede estar vacío.");

  const vault = getVaultActual();
  const existe = await select<{ id: string }>("SELECT id FROM notas WHERE id = ?", [id]);
  if (existe.length === 0) throw new DbError(404, "La nota no existe.");
  const carpeta = carpetaDeArchivo(id); // misma carpeta, distinto nombre
  const nuevoTitulo = sanearNombre(limpio);
  const newId = unir(carpeta, nuevoTitulo + extDe(id));
  if (newId !== id) {
    // Renombrar NO desambigua: si ya hay algo con ese nombre en la carpeta, se
    // rechaza (a diferencia de crear/duplicar, que sí añaden sufijo).
    if (await rutaOcupada(newId, id)) {
      throw new DbError(409, "Ya existe una nota o carpeta con ese nombre aquí.");
    }
    await moverRuta(vault, id, newId);
    await rekeyIndice([], [{ oldId: id, newId, newCarpetaId: carpeta, newTitulo: nuevoTitulo }]);
  }
  return { id: newId, titulo: nuevoTitulo };
}

/**
 * `POST /notas/{id}/mover`. Valida mismo vault. La ruta (id) cambia al mover de
 * carpeta: se devuelve el id NUEVO.
 */
export async function moverNota(
  id: string,
  destinoId: string | null,
): Promise<CreatedResponse> {
  if (destinoId !== null) {
    const [vaultDestino, vaultNota] = await Promise.all([
      vaultIdOfCarpeta(destinoId),
      vaultIdOfNota(id),
    ]);
    if (vaultDestino !== vaultNota) {
      throw new DbError(400, "El destino no pertenece al mismo vault.");
    }
  }

  const vault = getVaultActual();
  const existe = await select<{ id: string }>("SELECT id FROM notas WHERE id = ?", [id]);
  if (existe.length === 0) throw new DbError(404, "La nota no existe.");
  const newId = unir(destinoId, basenameDe(id)); // mismo archivo, otra carpeta
  if (newId !== id) {
    if (await rutaOcupada(newId, id)) {
      throw new DbError(409, "Ya existe una nota o carpeta con ese nombre en el destino.");
    }
    await moverRuta(vault, id, newId);
    await rekeyIndice(
      [],
      [{ oldId: id, newId, newCarpetaId: destinoId, newTitulo: tituloDeRuta(id) }],
    );
  }
  return { id: newId };
}

/** `POST /notas/{id}/duplicar`: copia archivo + contenido con título único. */
export async function duplicarNota(id: string): Promise<CreatedResponse> {
  const rows = await select<{
    vault_id: string;
    carpeta_id: string | null;
    titulo: string;
    tipo: string;
    tamano_bytes: number;
  }>("SELECT vault_id, carpeta_id, titulo, tipo, tamano_bytes FROM notas WHERE id = ?", [id]);
  if (rows.length === 0) throw new DbError(404, "La nota no existe.");
  const nota = rows[0];

  const now = ahoraIso();
  const vault = getVaultActual();

  // El sufijo por defecto es "(copia)" (estilo Obsidian) y la desambiguación se
  // hace a nivel de nombre de archivo (`nombreNotaLibre`).
  const { id: nuevo, titulo } = await nombreNotaLibre(
    nota.carpeta_id,
    `${nota.titulo} (copia)`,
    extDeTipo(nota.tipo),
  );
  await copiarArchivo(vault, id, nuevo);
  await execute(
    "INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, mtime, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [nuevo, nota.vault_id, nota.carpeta_id, titulo, nota.tipo, nota.tamano_bytes, Date.now(), now, now],
  );

  // Copia del contenido (si existe) y reindex FTS de la copia.
  const cont = await select<{ contenido: string }>(
    "SELECT contenido FROM contenidos WHERE nota_id = ?",
    [id],
  );
  if (cont.length > 0) {
    await execute("INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)", [
      nuevo,
      cont[0].contenido,
      now,
    ]);
    await ftsPoner(nuevo, titulo, cont[0].contenido);
    // La copia enlaza a lo mismo que el original (`FUN-L-25`).
    const enlaces = derivarEnlaces(cont[0].contenido, nota.tipo);
    const etiquetas = derivarEtiquetas(cont[0].contenido, nota.tipo);
    const resolver = enlaces.length > 0 ? await crearResolutor() : undefined;
    await escribirEnlacesTanda([{ id: nuevo, enlaces, etiquetas }], resolver);
    await execute("UPDATE notas SET hash_enlaces = ? WHERE id = ?", [
      huellaEnlaces(enlaces, etiquetas),
      nuevo,
    ]);
  }
  await reResolverTitulos([titulo]);

  return { id: nuevo };
}
