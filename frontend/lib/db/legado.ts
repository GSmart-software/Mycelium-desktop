/**
 * Migración única de la apariencia y los snippets CSS a su lugar actual
 * (`FUN-L-24`, 2026-09-26). Corre al abrir cada vault y no hace nada una vez
 * hecha.
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
import { select } from "./client";

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

/** Si el índice abierto tiene esta tabla (solo los de la 2.1.0 y anteriores). */
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
