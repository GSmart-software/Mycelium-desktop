/**
 * Contenido de notas (HU-04) + reindex FTS5 (HU-21). Portado de
 * `NoteContentEndpoints` + `VaultRepository.TouchNotaContenidoAsync`. El archivo
 * en disco es la fuente de verdad; la tabla `contenidos` del índice es su copia
 * para búsqueda, grafo y bases.
 *
 * `actualizadoEn` que ve el cliente es SIEMPRE `notas.actualizado_en` (no el de la
 * tabla de contenido), igual que en el backend.
 */
import { tipoDeNotaPorRuta } from "@/lib/arbolVivo";
import { decidirAlGuardar } from "@/lib/conflictoExterno";
import { derivarEnlaces, derivarEtiquetas } from "@/lib/enlacesNota";
import { execute, select } from "./client";
import { crearResolutor, escribirEnlacesTanda, huellaEnlaces } from "./enlacesIndice";
import { ftsPoner } from "./ftsIndice";
import { DbError } from "./errors";
import { derivarIndice, reindexarPropiedadesTanda } from "./propiedades";
import type { ContenidoResponse, PutContenidoResponse } from "./types";
import { ahoraIso, byteLen } from "./util";
import { getVaultActual } from "./vaultContext";
import { escribirNota, leerArchivoTexto } from "./vaultFs";

/** `GET /notas/{id}/contenido`. */
export async function getContenido(id: string): Promise<ContenidoResponse> {
  const rows = await select<{ actualizado_en: string; contenido: string | null }>(
    `SELECT n.actualizado_en, c.contenido
     FROM notas n LEFT JOIN contenidos c ON c.nota_id = n.id
     WHERE n.id = ?`,
    [id],
  );
  if (rows.length === 0) {
    // El explorador muestra lo que hay en disco ANTES de que el índice lo tenga
    // (`FUN-M-42`): una nota recién llegada puede abrirse en los cientos de
    // milisegundos que el indexado va detrás. Si el archivo está, se indexa
    // ahora y se responde; si no, es que de verdad no existe. Por `import()`:
    // es un camino raro y el indexador no hace falta para leer una nota.
    const tipo = tipoDeNotaPorRuta(id);
    if (tipo !== null) {
      const { indexarNotaADemanda } = await import("./indexer");
      if (await indexarNotaADemanda(getVaultActual(), id, tipo)) return getContenido(id);
    }
    throw new DbError(404, "La nota no existe.");
  }
  if (rows[0].contenido === null) {
    return { contenido: await reponerDesdeDisco(id), actualizadoEn: rows[0].actualizado_en };
  }
  return { contenido: rows[0].contenido, actualizadoEn: rows[0].actualizado_en };
}

/**
 * La nota está en el índice pero su contenido NO (`DEF-121`): se lee del disco,
 * que es la fuente de verdad, y se repone en `contenidos`.
 *
 * Antes se devolvía `""`, y no es lo mismo: «vacío» es un archivo de 0 bytes,
 * no un índice al que le falta la fila. Una vista que recibía `""` mostraba la
 * página en blanco —un `.drawio` de 6 KB, abierto como diagrama nuevo— y al
 * guardar pisaba el archivo real. El resto de lo que se deriva del contenido
 * (búsqueda, propiedades, enlaces) no se rehace acá: el `mtime` de la nota se
 * pone en 0 para que el próximo indexado la relea entera, que es justo lo que
 * hace con una nota a medio indexar (ver `indexarVault`), y las huellas en NULL
 * para que, si antes se guarda, `putContenido` no saltee nada.
 *
 * Si el archivo ya no está, es vacío como antes (el watcher lo sacará del
 * índice). Si existe pero no se puede leer, LANZA: mostrar un error es mejor que
 * mostrar vacío algo que guardar pisaría.
 */
async function reponerDesdeDisco(id: string): Promise<string> {
  const texto = await leerArchivoTexto(getVaultActual(), id);
  if (texto === null) return "";
  await execute(
    `INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT(nota_id) DO UPDATE SET contenido = excluded.contenido, actualizado_en = excluded.actualizado_en`,
    [id, texto, ahoraIso()],
  );
  await execute("UPDATE notas SET mtime = 0, hash_indexable = NULL, hash_enlaces = NULL WHERE id = ?", [id]);
  return texto;
}

/**
 * `GET /notas/{id}/contenido?origen=disco` (`DEF-138`): lo que el archivo tiene
 * AHORA, leído del disco y no del índice. `null` si ya no existe.
 *
 * El índice va detrás del watcher (debounce, reindexado): para decidir si lo de
 * afuera choca con lo que el usuario escribe, la foto tiene que ser la del
 * disco, o una carrera de milisegundos vuelve a perder lo de afuera.
 */
export async function leerContenidoEnDisco(id: string): Promise<{ contenido: string | null }> {
  return { contenido: await leerArchivoTexto(getVaultActual(), id) };
}

/** Mensaje del 409 de `putContenido` cuando el archivo cambió por fuera. */
export const MENSAJE_CAMBIO_EXTERNO = "El archivo cambió fuera de Mycelium.";

/**
 * `PUT /notas/{id}/contenido`: upsert contenido, actualiza metadatos y reindexa FTS.
 *
 * Con `esperado` (`DEF-138`), antes de escribir se compara el disco con esa base
 * —lo último que el editor leyó o guardó—: si alguien cambió el archivo desde
 * entonces, **no se escribe** y se lanza un 409. Así un guardado no pisa en
 * silencio lo que escribió la IA u otro programa aunque el aviso del watcher
 * todavía no haya llegado. Queda una ventana mínima entre la lectura y la
 * escritura, que es la de cualquier editor que no bloquea el archivo.
 */
export async function putContenido(
  id: string,
  contenido: string | null,
  esperado?: string | null,
): Promise<PutContenidoResponse> {
  const vault = getVaultActual();
  const notas = await select<{
    titulo: string;
    tipo: string;
    hash_indexable: string | null;
    hash_enlaces: string | null;
    con_busqueda: number;
  }>(
    // `con_busqueda` (`DEF-121`): si a la nota le falta su fila de búsqueda, la
    // huella no prueba nada —describe una fila que no está— y hay que escribirla.
    // Se mira en la tabla sombra de FTS5, como en `indexarVault`.
    `SELECT n.titulo, n.tipo, n.hash_indexable, n.hash_enlaces,
            EXISTS (SELECT 1 FROM fts_filas f JOIN notas_fts_docsize d ON d.id = f.fila
                    WHERE f.nota_id = n.id) AS con_busqueda
     FROM notas n WHERE n.id = ?`,
    [id],
  );
  if (notas.length === 0) throw new DbError(404, "La nota no existe.");

  const texto = contenido ?? "";
  if (esperado !== undefined) {
    const disco = await leerArchivoTexto(vault, id);
    if (decidirAlGuardar({ disco, conocido: esperado, local: texto }) === "conflicto") {
      throw new DbError(409, MENSAJE_CAMBIO_EXTERNO);
    }
  }
  const bytes = byteLen(texto);
  const now = ahoraIso();

  // Los archivos son la fuente de verdad. El editor ya llega con debounce de
  // 800 ms, así que se escribe en disco en cada guardado (id = ruta). El `mtime`
  // con que quedó el archivo va a `notas.mtime` (`FUN-M-38`): sin esto, el índice
  // seguía con el `mtime` de la última lectura, el reindexado incremental veía la
  // nota como cambiada y la volvía a leer y a indexar.
  const mtime = await escribirNota(vault, id, texto);

  await execute(
    `INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT(nota_id) DO UPDATE SET contenido = excluded.contenido, actualizado_en = excluded.actualizado_en`,
    [id, texto, now],
  );
  // Lo que se indexa es el CUERPO legible + los VALORES de las propiedades: el
  // YAML crudo (las claves, los guiones) ensuciaba la búsqueda y los fragmentos
  // de resultado (FUN-M-04), y la sintaxis del cuerpo también (`DEF-148`, ver
  // `derivarIndice`). Y solo si cambió (`FUN-M-38`, H10): la huella de lo
  // indexable se compara con la guardada, y si es la misma, ni `notas_fts` ni
  // `propiedades` se reescriben —en una nota de 500 KB, cientos de ms de FTS5
  // por cada guardado que no las tocaba—.
  const { contenido: buscable, extra, propiedades, huella } = derivarIndice(texto, notas[0].tipo);
  if (huella !== notas[0].hash_indexable || Number(notas[0].con_busqueda) !== 1) {
    await ftsPoner(id, notas[0].titulo, buscable, extra);
    await reindexarPropiedadesTanda([{ id, propiedades }]);
  }
  // Los enlaces y las etiquetas (`FUN-L-25`), con su propia huella: casi todo
  // guardado cambia el texto indexable y casi ninguno los enlaces. Si cambiaron,
  // las filas de la nota se reescriben ya resueltas —así el grafo y las
  // conexiones ven el `[[enlace]]` nuevo sin reindexar el vault—.
  const enlaces = derivarEnlaces(texto, notas[0].tipo);
  const etiquetas = derivarEtiquetas(texto, notas[0].tipo);
  const huellaE = huellaEnlaces(enlaces, etiquetas);
  if (huellaE !== notas[0].hash_enlaces) {
    const resolver = enlaces.length > 0 ? await crearResolutor() : undefined;
    await escribirEnlacesTanda([{ id, enlaces, etiquetas }], resolver);
  }
  // Las huellas se guardan DESPUÉS de reindexar: si `ftsPoner`, las propiedades
  // o los enlaces fallan, la nota queda con la huella vieja y el próximo
  // guardado reintenta.
  await execute(
    "UPDATE notas SET tamano_bytes = ?, actualizado_en = ?, mtime = ?, hash_indexable = ?, hash_enlaces = ? WHERE id = ?",
    [bytes, now, mtime, huella, huellaE, id],
  );

  return { actualizadoEn: now };
}
