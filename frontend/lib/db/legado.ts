/**
 * Migraciones únicas de lo que una versión anterior guardaba fuera de su lugar
 * actual. Corren al abrir cada vault y no hacen nada una vez hechas:
 *
 *   - la apariencia y los snippets CSS (`FUN-L-24`, 2026-09-26), abajo;
 *   - los dibujos de Excalidraw «embebidos» de la tabla `diagramas`
 *     (`FUN-M-40`, `DEF-112`), en `migrarDiagramasEmbebidos`.
 *
 * Desde `FUN-L-24` la apariencia (tema, modo oscuro, atmósferas, tipografía y
 * el resto de `preferencesStore`) vive en `.mycelium/preferencias.json` —claves
 * `tema`, `modoOscuro` y `preferencias`— y los snippets en
 * `.mycelium/snippets.json`, los dos leídos y escritos directo por sus stores.
 * Antes estaban en uno de estos dos lugares, según la versión que los guardó:
 *
 *   1. `.mycelium/apariencia.json` (las versiones de desarrollo con `DEF-107`):
 *      `{ version, tema, modoOscuro, preferencias }`. Se copian sus claves a
 *      `preferencias.json` y se **borra**: nadie lo vuelve a escribir.
 *   2. El índice (`index-<hash>.db`) de la 2.1.0 y anteriores: la fila
 *      `usuarios` (`tema`, `modo_oscuro`, `preferencias_json`) y la tabla
 *      `css_snippets`. Se copian a los archivos si estos todavía no existen.
 *
 * > [!warning] Por esto el índice no hace `DROP TABLE` de las tablas viejas
 * > Quien actualiza desde la 2.1.0 tiene su tema y sus snippets **solo** ahí.
 * > Borrarlas al abrir, antes o después de una migración que pudo fallar, sería
 * > perderlos. Ocupan unos pocos KB y nadie más las lee; se pueden retirar el
 * > día que ya no quede ningún índice de la 2.1.0 (o nunca: el índice es
 * > desechable, y reconstruirlo las borra).
 *
 * Todo es best-effort: un fallo acá se registra y el vault abre igual, con los
 * valores por defecto — un ajuste de aspecto no puede impedir abrir un vault.
 */
import { execute, select } from "./client";
import { desambiguar, sanearNombre } from "./nombres";

/** Lo que se busca en cualquiera de los dos orígenes. */
export type Apariencia = {
  tema: string;
  modoOscuro: boolean;
  preferencias: unknown;
};

async function invocar<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const leerEstado = (vault: string, nombre: string) =>
  invocar<string | null>("leer_estado_vault", { ruta: vault, nombre });

const escribirEstado = (vault: string, nombre: string, datos: unknown) =>
  invocar<void>("escribir_estado_vault", {
    ruta: vault,
    nombre,
    contenido: JSON.stringify(datos, null, 2),
  });

/** `JSON.parse` que devuelve `null` en vez de lanzar. */
function parsear(texto: string | null): unknown {
  if (texto === null) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Si `preferencias.json` ya tiene la apariencia. Basta con `tema`: las tres
 * claves se escriben siempre juntas, por `preferencesStore` o por esta
 * migración. Pura, para testearla sin Tauri.
 */
export function yaTieneApariencia(prefs: unknown): boolean {
  return esObjeto(prefs) && "tema" in prefs;
}

/**
 * La apariencia que traía un `apariencia.json`, o `null` si no tiene forma de
 * una. No valida los valores: eso lo hace `normalizar` al cargar, igual que con
 * un `preferencias.json` editado a mano. Pura.
 */
export function aparienciaDeArchivo(crudo: unknown): Apariencia | null {
  if (!esObjeto(crudo) || typeof crudo.tema !== "string") return null;
  return {
    tema: crudo.tema,
    modoOscuro: crudo.modoOscuro !== false,
    preferencias: crudo.preferencias ?? {},
  };
}

/**
 * `preferencias.json` con la apariencia agregada, sin tocar lo que ya tenía
 * (números de línea, grafo, anchos de tabla…). Un archivo ilegible cuenta como
 * vacío: lo reescribiría igual el próximo guardado. Pura.
 */
export function fusionarApariencia(prefs: unknown, apariencia: Apariencia): Record<string, unknown> {
  return {
    ...(esObjeto(prefs) ? prefs : {}),
    tema: apariencia.tema,
    modoOscuro: apariencia.modoOscuro,
    preferencias: esObjeto(apariencia.preferencias) ? apariencia.preferencias : {},
  };
}

/** Si el índice abierto tiene esta tabla (las viejas solo están en índices anteriores). */
async function hayTabla(nombre: string): Promise<boolean> {
  const filas = await select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [nombre],
  );
  return filas.length > 0;
}

/** La apariencia de la fila `usuarios` de un índice viejo, o `null`. */
async function aparienciaDelIndice(): Promise<Apariencia | null> {
  if (!(await hayTabla("usuarios"))) return null;
  const filas = await select<{ tema: string; modo_oscuro: number; preferencias_json: string | null }>(
    "SELECT tema, modo_oscuro, preferencias_json FROM usuarios LIMIT 1",
  );
  if (filas.length === 0) return null;
  const f = filas[0];
  return {
    tema: f.tema,
    modoOscuro: f.modo_oscuro === 1,
    preferencias: parsear(f.preferencias_json) ?? {},
  };
}

async function migrarApariencia(vault: string): Promise<void> {
  const textoLegado = await leerEstado(vault, "apariencia.json");
  const prefs = parsear(await leerEstado(vault, "preferencias.json"));

  if (!yaTieneApariencia(prefs)) {
    const apariencia = aparienciaDeArchivo(parsear(textoLegado)) ?? (await aparienciaDelIndice());
    if (apariencia !== null) {
      await escribirEstado(vault, "preferencias.json", fusionarApariencia(prefs, apariencia));
    }
  }
  // Se borra DESPUÉS de escribir: si la escritura falló, lanzó antes de llegar
  // acá y el archivo sigue ahí para el próximo intento.
  if (textoLegado !== null) {
    await invocar<void>("borrar_estado_vault", { ruta: vault, nombre: "apariencia.json" });
  }
}

async function migrarSnippets(vault: string): Promise<void> {
  if ((await leerEstado(vault, "snippets.json")) !== null) return;
  if (!(await hayTabla("css_snippets"))) return;
  const filas = await select<{ id: string; nombre: string; activo: number; contenido: string }>(
    "SELECT id, nombre, activo, contenido FROM css_snippets ORDER BY creado_en",
  );
  if (filas.length === 0) return;
  await escribirEstado(vault, "snippets.json", {
    version: 1,
    snippets: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      activo: f.activo === 1,
      contenido: f.contenido,
    })),
  });
}

/**
 * Corre las dos migraciones sobre el vault cuyo índice está abierto. Va antes de
 * cargar las preferencias del vault y los snippets: es lo que hace que un vault
 * viejo abra con su apariencia y no con la de por defecto.
 */
export async function migrarEstadoLegado(vault: string): Promise<void> {
  try {
    await migrarApariencia(vault);
  } catch (e) {
    console.error("[Mycelium] migración · no se pudo migrar la apariencia a preferencias.json", e);
  }
  try {
    await migrarSnippets(vault);
  } catch (e) {
    console.error("[Mycelium] migración · no se pudieron migrar los snippets a snippets.json", e);
  }
}

// ── Dibujos de Excalidraw «embebidos» (`FUN-M-40`, `DEF-112`) ─────────────────
//
// Hasta la 2.1.0, soltar un `.excalidraw` sobre el editor guardaba la escena en
// la tabla `diagramas` del índice, colgada de la nota (`nota_id`, `diag_id`), y
// escribía `![[<diag_id>.excalidraw]]` en el texto. Ese dibujo no existía en
// disco: reconstruir el índice lo borraba sin aviso. Ahora un dibujo es siempre
// un archivo del vault, así que lo que quede en la tabla se exporta a archivos
// `.excalidraw` junto a su nota, se reescribe el embed para que apunte al
// archivo y la tabla se borra.

/** Una fila de la tabla `diagramas` de un índice anterior a `FUN-M-40`. */
type DiagramaLegado = { diagId: string; contenido: string };

/** Carpeta (ruta POSIX) de una ruta de archivo, o `null` en la raíz. Pura. */
function carpetaDe(ruta: string): string | null {
  const i = ruta.lastIndexOf("/");
  return i < 0 ? null : ruta.slice(0, i);
}

/** Nombre sin carpeta ni extensión (`Proyectos/plan.md` → `plan`). Pura. */
function tituloDe(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(0, i) : nombre;
}

const unirRuta = (carpeta: string | null, nombre: string) =>
  carpeta === null ? nombre : `${carpeta}/${nombre}`;

/**
 * Dónde queda el dibujo de una nota: en la carpeta de la nota, con el nombre
 * `«título de la nota» - dibujo` desambiguado por sufijo como cualquier
 * creación (`… - dibujo 1`, `… - dibujo 2`). `ocupada` recibe una ruta relativa
 * **en minúsculas** —Windows no distingue— y dice si ya hay algo ahí. Devuelve
 * la ruta del archivo y la referencia para el embed: con la carpeta delante,
 * para que dos notas homónimas en carpetas distintas no apunten al mismo
 * dibujo. Pura.
 */
export function destinoDeDiagrama(
  notaId: string,
  ocupada: (rutaMinusculas: string) => boolean,
): { ruta: string; ref: string } {
  const carpeta = carpetaDe(notaId);
  const base = sanearNombre(`${tituloDe(notaId)} - dibujo`);
  const stem = desambiguar(base, (cand) => {
    const ruta = unirRuta(carpeta, cand).toLowerCase();
    return ocupada(`${ruta}.excalidraw`) || ocupada(ruta);
  });
  return { ruta: unirRuta(carpeta, `${stem}.excalidraw`), ref: unirRuta(carpeta, stem) };
}

/** El embed `![[<diagId>.excalidraw]]`, sin distinguir mayúsculas en el uuid. */
function embedDeDiagrama(diagId: string): RegExp {
  const escapado = diagId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`!\\[\\[${escapado}\\.excalidraw\\]\\]`, "gi");
}

/** Si `texto` muestra el dibujo `diagId`. Pura. */
export function usaDiagrama(texto: string, diagId: string): boolean {
  return embedDeDiagrama(diagId).test(texto);
}

/**
 * Reescribe en `texto` cada `![[<diagId>.excalidraw]]` para que apunte a `ref`.
 * El uuid se compara sin distinguir mayúsculas; lo demás del texto no se toca.
 * Pura.
 */
export function reescribirEmbedDeDiagrama(texto: string, diagId: string, ref: string): string {
  return texto.replace(embedDeDiagrama(diagId), () => `![[${ref}.excalidraw]]`);
}

const leerTexto = (vault: string, rutaRel: string) =>
  invocar<string | null>("leer_archivo_texto", { vaultRuta: vault, rutaRel });

const escribirTexto = (vault: string, rutaRel: string, contenido: string) =>
  invocar<number>("escribir_nota", { vaultRuta: vault, rutaRel, contenido });

/**
 * Exporta a archivos los dibujos de la tabla `diagramas` y la borra. Va
 * **antes** de indexar: trabaja sobre el disco, y el indexado que sigue ve los
 * archivos nuevos y las notas reescritas como cualquier cambio.
 *
 * - Cada fila se escribe en `destinoDeDiagrama` y el embed de su nota se
 *   reescribe; la nota se guarda una vez, con todos sus embeds nuevos.
 * - Las filas de una nota se borran de la tabla **en cuanto** esa nota quedó
 *   escrita: si algo falla a mitad de camino, lo ya migrado no se vuelve a
 *   exportar la próxima vez, y lo que falta sigue en la tabla.
 * - Una fila cuya nota ya no está en disco no se exporta: el indexado la habría
 *   borrado igual (la tabla la tenía con `ON DELETE CASCADE`), que es lo que
 *   pasaba hasta ahora.
 * - Tampoco una cuya nota ya no la muestra: borrar el embed nunca borraba la
 *   fila, así que la tabla guarda dibujos que nadie ve. Exportarlos llenaría la
 *   carpeta de archivos sueltos, y es además lo que hace que reintentar tras un
 *   corte no duplique lo que ya se exportó (su embed ya no es el uuid).
 * - `DROP TABLE` al final, con la tabla ya vacía.
 *
 * Best-effort, como el resto: un fallo se registra y el vault abre igual, con lo
 * que falte todavía en la tabla para el próximo intento.
 */
export async function migrarDiagramasEmbebidos(vault: string): Promise<void> {
  try {
    if (!(await hayTabla("diagramas"))) return;
    const filas = await select<{ nota_id: string; diag_id: string; contenido: string }>(
      "SELECT nota_id, diag_id, contenido FROM diagramas ORDER BY nota_id, diag_id",
    );

    // Lo ocupado según el índice (el de la sesión anterior); el disco se
    // comprueba igual antes de escribir cada archivo.
    const ocupadas = new Set<string>();
    for (const tabla of ["notas", "carpetas"]) {
      for (const f of await select<{ id: string }>(`SELECT id FROM ${tabla}`)) {
        ocupadas.add(f.id.toLowerCase());
      }
    }
    const libre = (notaId: string) => destinoDeDiagrama(notaId, (r) => ocupadas.has(r));

    const porNota = new Map<string, DiagramaLegado[]>();
    for (const f of filas) {
      const lista = porNota.get(f.nota_id) ?? [];
      lista.push({ diagId: f.diag_id, contenido: f.contenido });
      porNota.set(f.nota_id, lista);
    }

    for (const [notaId, diagramas] of porNota) {
      const original = await leerTexto(vault, notaId);
      if (original !== null) {
        let texto = original;
        for (const d of diagramas) {
          if (!usaDiagrama(texto, d.diagId)) continue;
          let destino = libre(notaId);
          while ((await leerTexto(vault, destino.ruta)) !== null) {
            ocupadas.add(destino.ruta.toLowerCase());
            destino = libre(notaId);
          }
          await escribirTexto(vault, destino.ruta, d.contenido);
          ocupadas.add(destino.ruta.toLowerCase());
          texto = reescribirEmbedDeDiagrama(texto, d.diagId, destino.ref);
        }
        if (texto !== original) await escribirTexto(vault, notaId, texto);
      }
      await execute("DELETE FROM diagramas WHERE nota_id = ?", [notaId]);
    }

    await execute("DROP TABLE diagramas");
  } catch (e) {
    console.error("[Mycelium] migración · no se pudieron exportar los dibujos embebidos", e);
  }
}
