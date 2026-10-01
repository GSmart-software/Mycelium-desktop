import type { NotaTipo } from "@/stores/vaultStore";

/**
 * Qué extensión le corresponde a cada tipo de documento, **sin punto**.
 *
 * Vive acá por el mismo motivo que los íconos viven en `lib/iconosDeTipo`
 * (`FUN-S-11`): la pregunta «qué extensión tiene este tipo» no puede tener dos
 * respuestas en dos archivos. Antes había tres copias —`extDeTipo` en
 * `lib/db/vaultFs.ts`, `EXTENSION_POR_TIPO` en el explorador, y la lista de
 * extensiones que `resolveWikilink` sabe quitar— y agregar `.drawio` (`FUN-L-20`)
 * tocó solo una: el archivo se creaba bien, pero se listaba sin extensión y los
 * embeds `![[diagrama.drawio]]` **no resolvían a nada**.
 *
 * > [!important] El `Record<NotaTipo, …>` es la parte que importa
 * > Es lo que hace que agregar un tipo **no compile** hasta contestar acá. Un
 * > `Record<string, …>` habría dejado pasar el tipo nuevo en silencio, que es
 * > exactamente como se coló el defecto.
 */
export const EXTENSION_POR_TIPO: Record<NotaTipo, string> = {
  markdown: "md",
  excalidraw: "excalidraw",
  base: "base",
  canvas: "canvas",
  drawio: "drawio",
};

/**
 * Con qué título nace un documento de cada tipo cuando el usuario no da uno.
 *
 * Misma regla que la extensión: una sola tabla, con `Record<NotaTipo, …>` para
 * que un tipo nuevo no compile hasta contestar acá. Antes estaba escrita dos
 * veces —en `vaultStore.createNota` y en `lib/db/notas.crearNota`— y ambas
 * tenían que coincidir a mano (auditoría del 2026-09-26, H11).
 */
export const TITULO_POR_DEFECTO: Record<NotaTipo, string> = {
  markdown: "Sin título",
  excalidraw: "Dibujo sin título",
  base: "Base sin título",
  canvas: "Lienzo sin título",
  drawio: "Diagrama sin título",
};

/**
 * Todas las extensiones de nota, sin punto.
 *
 * La usan la resolución de wikilinks —para quitar la extensión de
 * `![[archivo.ext]]`, ya que el título de una nota no la incluye— y cualquiera
 * que tenga que reconocer «esto nombra a un archivo del vault».
 */
export const EXTENSIONES_DE_NOTA: readonly string[] = Object.values(EXTENSION_POR_TIPO);

/**
 * El tipo de documento que nombra la extensión del final de un nombre, o `null`
 * si no termina en una extensión de nota.
 *
 * `"Eval/Devoluciones.excalidraw"` → `"excalidraw"`; `"Plan.MD"` → `"markdown"`;
 * `"notas.de.ayer"` → `null`. Es lo que usa la resolución de wikilinks para que
 * `![[x.excalidraw]]` busque **solo entre dibujos** (`DEF-120`).
 */
export function tipoDeExtension(nombre: string): NotaTipo | null {
  const i = nombre.lastIndexOf(".");
  if (i <= 0) return null;
  const ext = nombre.slice(i + 1).toLowerCase();
  const tipo = (Object.keys(EXTENSION_POR_TIPO) as NotaTipo[]).find(
    (t) => EXTENSION_POR_TIPO[t] === ext,
  );
  return tipo ?? null;
}

/**
 * Quita la extensión de nota del final de un nombre, si la tiene.
 *
 * `"diagrama.drawio"` → `"diagrama"`; `"notas.de.ayer"` → `"notas.de.ayer"`
 * (`de.ayer` no es una extensión de nota, y recortarla rompería el nombre).
 */
export function sinExtensionDeNota(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  if (i <= 0) return nombre;
  const ext = nombre.slice(i + 1).toLowerCase();
  return EXTENSIONES_DE_NOTA.includes(ext) ? nombre.slice(0, i) : nombre;
}
