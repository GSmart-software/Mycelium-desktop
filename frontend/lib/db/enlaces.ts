/**
 * Lado de E/S de la auditoría y el re-enlazado (`FUN-M-17` / `FUN-L-17`): leer el
 * corpus, leer y escribir el léxico, y aplicar las formas con respaldo, manifiesto
 * y deshacer. La lógica —qué es una referencia y cómo se reescribe— vive en
 * `lib/enlaces.ts`, que es puro y no toca disco.
 * Ver `docs/features/auditoria-y-relinkeado.md`.
 *
 * > [!danger] Acá está la mitad que SÍ escribe
 * > `inventario()` y todo lo que consume la auditoría son de solo lectura.
 * > `aplicar()` reescribe documentos, y por eso es la única función del módulo
 * > que exige un respaldo antes de tocar nada.
 */
import {
  aplicarFormas,
  compilarFormas,
  escribirLexico,
  leerLexico,
  RUTA_LEXICO,
  type DocumentoTexto,
  type Lexico,
  type Reemplazo,
} from "@/lib/enlaces";
import { select } from "./client";
import { putContenido } from "./contenido";
import { getVaultActual } from "./vaultContext";
import { copiarArchivo, escribirNota, leerArchivoTexto } from "./vaultFs";

/** Carpeta donde viven los respaldos. `.mycelium/` no se indexa ni se ve. */
const DIR_RESPALDOS = ".mycelium/relink";

export type Inventario = {
  docs: DocumentoTexto[];
  notas: { id: string; titulo: string }[];
  lexico: Lexico;
};

/**
 * Todo lo que la auditoría necesita, en una sola pasada. **No escribe nada.**
 *
 * Solo notas markdown: un `.excalidraw` es JSON y un `.base` es una consulta —
 * reescribir referencias ahí no tendría sentido.
 */
export async function inventario(vaultId: string): Promise<Inventario> {
  const filas = await select<{ id: string; titulo: string; contenido: string | null }>(
    `SELECT n.id, n.titulo, c.contenido AS contenido
       FROM notas n LEFT JOIN contenidos c ON c.nota_id = n.id
      WHERE n.vault_id = ?
        AND n.tipo = 'markdown'
        AND n.id NOT IN (SELECT nota_id FROM papelera)
      ORDER BY n.id`,
    [vaultId],
  );

  const notas = filas.map((f) => ({ id: f.id, titulo: f.titulo }));
  const docs = filas.map((f) => ({ id: f.id, titulo: f.titulo, texto: f.contenido ?? "" }));

  return { docs, notas, lexico: await cargarLexico() };
}

/** Lee el léxico del vault. Es el mismo archivo que usan los comandos de la IA. */
export async function cargarLexico(): Promise<Lexico> {
  const vault = getVaultActual();
  if (vault === null) return leerLexico(null);
  try {
    return leerLexico(await leerArchivoTexto(vault, RUTA_LEXICO));
  } catch {
    return leerLexico(null);
  }
}

/**
 * Guarda el léxico. Es lo ÚNICO que escribe la auditoría, y va fuera del vault
 * visible (`.claude/`), así que no altera ningún documento.
 */
export async function guardarLexico(lexico: Lexico): Promise<void> {
  const vault = getVaultActual();
  if (vault === null) {
    throw new Error(
      "El léxico se guarda en la carpeta del vault, y este vault no está abierto en modo carpeta.",
    );
  }
  await escribirNota(vault, RUTA_LEXICO, escribirLexico(lexico));
}

// ── Aplicación ────────────────────────────────────────────────────────────────

export type CambioArchivo = {
  id: string;
  reemplazos: Reemplazo[];
  hashAntes: string;
  hashDespues: string;
};

export type Manifiesto = {
  version: 1;
  timestamp: string;
  archivos: CambioArchivo[];
};

export type ResultadoAplicacion = {
  /** `null` en simulacro: no se respaldó nada porque no se escribió nada. */
  timestamp: string | null;
  archivos: CambioArchivo[];
  reemplazos: number;
};

/** SHA-256 en hexadecimal, para poder detectar ediciones posteriores. */
async function hash(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Convierte las referencias del léxico en wikilinks a lo largo de todo el vault.
 *
 * El orden importa y es deliberado: **primero se respalda el archivo, después se
 * escribe**. Hoy no hay deshacer de contenido en Mycelium (`putContenido`
 * sobrescribe y el historial de CodeMirror vive solo en memoria), así que el
 * respaldo es la única red que hay.
 *
 * Con `simulacro`, calcula exactamente lo mismo y no escribe nada — ni respaldo,
 * ni documentos, ni manifiesto.
 */
export async function aplicar(
  vaultId: string,
  opciones: { simulacro?: boolean } = {},
): Promise<ResultadoAplicacion> {
  const vault = getVaultActual();
  const { docs, lexico } = await inventario(vaultId);
  const formas = compilarFormas(lexico);
  const simulacro = opciones.simulacro === true;

  if (formas.length === 0) {
    throw new Error("El léxico está vacío: no hay ninguna forma que aplicar todavía.");
  }
  if (!simulacro && vault === null) {
    throw new Error(
      "El re-enlazado necesita la carpeta del vault para poder respaldar antes de escribir.",
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirRespaldo = `${DIR_RESPALDOS}-${timestamp}`;
  const archivos: CambioArchivo[] = [];

  for (const doc of docs) {
    const { texto, reemplazos } = aplicarFormas(doc.texto, formas);
    if (reemplazos.length === 0) continue;

    const cambio: CambioArchivo = {
      id: doc.id,
      reemplazos,
      hashAntes: await hash(doc.texto),
      hashDespues: await hash(texto),
    };

    if (!simulacro) {
      // Respaldo ANTES de escribir. Si esto falla, el documento no se toca.
      await copiarArchivo(vault!, doc.id, `${dirRespaldo}/${doc.id}`);
      await putContenido(doc.id, texto);
    }
    archivos.push(cambio);
  }

  if (!simulacro && archivos.length > 0) {
    const manifiesto: Manifiesto = { version: 1, timestamp, archivos };
    await escribirNota(
      vault!,
      `${dirRespaldo}/manifiesto.json`,
      `${JSON.stringify(manifiesto, null, 2)}\n`,
    );
  }

  return {
    timestamp: simulacro || archivos.length === 0 ? null : timestamp,
    archivos,
    reemplazos: archivos.reduce((a, c) => a + c.reemplazos.length, 0),
  };
}

// ── Deshacer ──────────────────────────────────────────────────────────────────

export type ResultadoDeshacer = {
  restaurados: string[];
  /** Archivos editados DESPUÉS de la conversión: se avisan y no se pisan. */
  omitidos: { id: string; motivo: string }[];
};

/** Los respaldos disponibles, del más reciente al más viejo. */
export async function respaldos(): Promise<Manifiesto[]> {
  const vault = getVaultActual();
  if (vault === null) return [];
  const encontrados: Manifiesto[] = [];
  // No hay `listar_directorios` acotado a `.mycelium/`, así que se recuerda el
  // último aplicado en el propio vault: alcanza para el caso real (deshacer lo
  // que acabás de hacer) y evita agregar un comando nuevo en Rust.
  const json = await leerArchivoTexto(vault, `${DIR_RESPALDOS}-ultimo.json`).catch(() => null);
  if (json !== null) {
    try {
      encontrados.push(JSON.parse(json) as Manifiesto);
    } catch {
      // Un puntero ilegible no debe impedir el resto de la pantalla.
    }
  }
  return encontrados;
}

/**
 * Devuelve los archivos de una conversión a su contenido anterior.
 *
 * > [!important] Un archivo editado después NO se pisa
 * > Se compara su hash actual con el `hashDespues` del manifiesto. Si no
 * > coinciden, el usuario escribió encima: restaurar borraría ese trabajo, así
 * > que se avisa y se deja como está. Deshacer no puede costar más que no
 * > deshacer.
 */
export async function deshacer(manifiesto: Manifiesto): Promise<ResultadoDeshacer> {
  const vault = getVaultActual();
  if (vault === null) throw new Error("Deshacer necesita la carpeta del vault.");

  const dirRespaldo = `${DIR_RESPALDOS}-${manifiesto.timestamp}`;
  const restaurados: string[] = [];
  const omitidos: { id: string; motivo: string }[] = [];

  for (const archivo of manifiesto.archivos) {
    const actual = await leerArchivoTexto(vault, archivo.id).catch(() => null);
    if (actual === null) {
      omitidos.push({ id: archivo.id, motivo: "el archivo ya no existe" });
      continue;
    }
    if ((await hash(actual)) !== archivo.hashDespues) {
      omitidos.push({ id: archivo.id, motivo: "lo editaste después de la conversión" });
      continue;
    }
    const respaldo = await leerArchivoTexto(vault, `${dirRespaldo}/${archivo.id}`).catch(() => null);
    if (respaldo === null) {
      omitidos.push({ id: archivo.id, motivo: "no se encontró su respaldo" });
      continue;
    }
    await putContenido(archivo.id, respaldo);
    restaurados.push(archivo.id);
  }

  return { restaurados, omitidos };
}

/** Recuerda el último manifiesto, para poder ofrecer deshacerlo. */
export async function recordarUltimo(manifiesto: Manifiesto): Promise<void> {
  const vault = getVaultActual();
  if (vault === null) return;
  await escribirNota(
    vault,
    `${DIR_RESPALDOS}-ultimo.json`,
    `${JSON.stringify(manifiesto, null, 2)}\n`,
  );
}
