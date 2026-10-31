import { sanearNombre } from "@/lib/db/nombres";
import { sinExtensionDeNota, tipoDeExtension } from "@/lib/extensionesDeTipo";
import { folderSegments, type CarpetaEnlazable } from "@/lib/wikilinks";
import type { NotaTipo } from "@/stores/vaultStore";

/**
 * Qué crear al hacer clic en un `[[enlace]]` a una nota que no existe
 * (`FUN-S-31`), como Obsidian. Módulo puro —decide, no crea—, probado en
 * `scripts/test-enlace-roto.mjs`; lo ejecuta `lib/crearDesdeEnlace.ts`.
 */
export type PlanEnlaceRoto = {
  /** Carpeta existente donde va la nota, o donde empiezan las que hay que crear (`null` = raíz). */
  carpetaId: string | null;
  /** Carpetas que faltan, de afuera hacia adentro, ya saneadas. */
  crearCarpetas: string[];
  /** Título de la nota nueva, ya saneado (es el nombre del archivo). */
  titulo: string;
  tipo: NotaTipo;
};

/**
 * Extensiones de archivos que no son notas: un `[[foto.png]]` roto no se
 * resuelve creando una nota llamada «foto.png».
 */
const NO_SON_NOTAS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico",
  "pdf", "mp3", "wav", "ogg", "m4a", "flac", "mp4", "webm", "mov", "mkv",
]);

/** Ruta de una carpeta (raíz → hoja) en minúsculas, para comparar. */
const rutaDe = (id: string, carpetas: readonly CarpetaEnlazable[]) =>
  folderSegments(id, carpetas).map((s) => s.toLowerCase());

/**
 * Plan para crear la nota de un enlace roto.
 *
 * - `base` es lo que nombra la nota, SIN el ancla: `[[Nota#Sección]]` crea
 *   «Nota» (quien llama ya lo separó con `resolverReferencia`).
 * - Sin ruta, va a `carpetaPorDefecto` (la raíz si es `null`).
 * - Con ruta (`[[Carpeta/Nota]]`), a la carpeta cuya ruta **termina** con esos
 *   segmentos —la misma regla con la que el enlace resuelve (`wikilinks.ts`,
 *   regla 3)—, la menos profunda si hay varias. Si no existe ninguna, se crean
 *   las que falten desde la raíz, reusando las que ya estén: así el enlace
 *   resuelve a la nota nueva y un segundo clic la abre en vez de crear otra.
 * - Con extensión de nota (`.md`, `.canvas`, `.excalidraw`…), del tipo que
 *   dice; con la de una imagen o un PDF, `null`: no es una nota.
 * - Los caracteres que un nombre de archivo no admite (`? : * | " < > \`) se
 *   sanean como en cualquier nota nueva. Si no queda nada, `null`.
 */
export function planDeEnlaceRoto(
  base: string,
  carpetas: readonly CarpetaEnlazable[],
  carpetaPorDefecto: string | null = null,
): PlanEnlaceRoto | null {
  const partes = base
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;

  const ultimo = partes[partes.length - 1];
  const punto = ultimo.lastIndexOf(".");
  if (punto > 0 && NO_SON_NOTAS.has(ultimo.slice(punto + 1).toLowerCase())) return null;
  const tipo = tipoDeExtension(ultimo) ?? "markdown";
  const titulo = sanearNombre(sinExtensionDeNota(ultimo), "");
  if (titulo === "") return null;

  const pista = partes.slice(0, -1);
  if (pista.length === 0) return { carpetaId: carpetaPorDefecto, crearCarpetas: [], titulo, tipo };

  // 1) Una carpeta cuya ruta termina con la pista: la nota resolverá ahí.
  const buscada = pista.map((s) => s.toLowerCase());
  const candidatas = carpetas
    .map((c) => ({ c, ruta: rutaDe(c.id, carpetas) }))
    .filter(
      ({ ruta }) =>
        ruta.length >= buscada.length &&
        buscada.every((s, i) => ruta[ruta.length - buscada.length + i] === s),
    )
    .sort((a, b) => a.ruta.length - b.ruta.length || (a.c.id < b.c.id ? -1 : 1));
  if (candidatas.length > 0) {
    return { carpetaId: candidatas[0].c.id, crearCarpetas: [], titulo, tipo };
  }

  // 2) Ninguna: desde la raíz, lo que ya existe se reusa y lo que falta se crea.
  let padre: string | null = null;
  let i = 0;
  for (; i < pista.length; i++) {
    const nombre = pista[i].toLowerCase();
    const hija = carpetas.find((c) => c.padreId === padre && c.nombre.toLowerCase() === nombre);
    if (!hija) break;
    padre = hija.id;
  }
  const crearCarpetas = pista.slice(i).map((s) => sanearNombre(s, ""));
  if (crearCarpetas.some((s) => s === "")) return null;
  return { carpetaId: padre, crearCarpetas, titulo, tipo };
}
