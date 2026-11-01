/**
 * Los esquemas de propiedades del vault abierto (`FUN-M-46`): lee
 * `esquemas.yml` de la raíz, lo vuelve a leer cuando cambia (guardado desde el
 * visor, cambio por fuera, cambio de vault) y le da a la app y al MCP una sola
 * forma de validar una nota. La lógica pura está en `lib/esquemas.ts`.
 *
 * - La tarjeta de propiedades del editor y la pestaña PROPIEDADES llaman a
 *   `avisosDeNota` con el texto **del editor** (en vivo, sin índice).
 * - `mycelium_validar_nota` recibe el chequeo «Propiedades válidas» por
 *   `registrarValidadorNota` (abajo, al importar este módulo).
 * - El panel de salud y `mycelium_salud` usan `propiedadesQueNoCumplen`.
 *
 * Un `esquemas.yml` mal escrito no rompe nada: se ignora lo inválido y sus
 * avisos se muestran en el panel de salud y, al cambiar, en un aviso flotante.
 * Solo desktop.
 */
import { useSyncExternalStore } from "react";
import { leerArchivoTexto } from "@/lib/db/vaultFs";
import { getVaultActual } from "@/lib/db/vaultContext";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { carpetaEsporas } from "@/lib/esporasVault";
import {
  RUTA_ESQUEMAS,
  avisosAlmohadilla,
  chequeoPropiedades,
  cuantosAplican,
  parsearEsquemas,
  validarPropiedades,
  type ArchivoEsquemas,
  type AvisoPropiedad,
  type NotaEsquema,
} from "@/lib/esquemas";
import { EVENTO_ARCHIVO_GUARDADO, EVENTO_RECARGA } from "@/lib/eventos";
import { excluida, registrarValidadorNota } from "@/lib/salud";
import { avisar } from "@/stores/avisosStore";
import { useVaultStore } from "@/stores/vaultStore";

const VACIO: ArchivoEsquemas = { esquemas: [], avisos: [] };

let archivo: ArchivoEsquemas = VACIO;
/** De qué vault es `archivo` (para no mezclar al cambiar de vault). */
let deVault: string | null = null;
let cargando: Promise<void> | null = null;
let version = 0;
const oyentes = new Set<() => void>();

function emitir() {
  version++;
  for (const o of oyentes) o();
}

/** Los esquemas y los avisos del archivo, como están ahora (sin leer el disco). */
export function esquemasActuales(): ArchivoEsquemas {
  return archivo;
}

/** Lee (o relee) `esquemas.yml`. Sin archivo, sin esquemas. Nunca lanza. */
export async function recargarEsquemas(): Promise<void> {
  let vault: string;
  try {
    vault = getVaultActual();
  } catch {
    archivo = VACIO;
    deVault = null;
    emitir();
    return;
  }
  const previo = deVault === vault ? archivo : VACIO;
  let texto: string | null = null;
  try {
    texto = await leerArchivoTexto(vault, RUTA_ESQUEMAS);
  } catch (e) {
    console.warn("[Mycelium] no se pudo leer esquemas.yml", e);
  }
  archivo = texto === null ? VACIO : parsearEsquemas(texto);
  deVault = vault;
  emitir();
  // Las tarjetas de propiedades abiertas se vuelven a validar.
  refreshAllLiveViews();
  const antes = previo.avisos.map((a) => a.mensaje).join("\n");
  const ahora = archivo.avisos.map((a) => a.mensaje).join("\n");
  if (ahora !== "" && ahora !== antes) {
    avisar(
      `${RUTA_ESQUEMAS} tiene ${archivo.avisos.length === 1 ? "un problema" : `${archivo.avisos.length} problemas`}: ` +
        `${archivo.avisos[0].mensaje}${archivo.avisos.length > 1 ? " Los demás, en el panel de salud." : ""}`,
    );
  }
}

/** Se asegura de que estén leídos los esquemas del vault abierto. */
export async function asegurarEsquemas(): Promise<ArchivoEsquemas> {
  let vault: string | null = null;
  try {
    vault = getVaultActual();
  } catch {
    return VACIO;
  }
  if (deVault !== vault) {
    cargando ??= recargarEsquemas().finally(() => {
      cargando = null;
    });
    await cargando;
  }
  return archivo;
}

// ── Escuchar los cambios ─────────────────────────────────────────────────────

let escuchando = false;

const tocaEsquemas = (e: Event): boolean => {
  const rutas = (e as CustomEvent<{ rutas?: string[]; ruta?: string }>).detail;
  if (!rutas) return true; // sin detalle: «pudo cambiar cualquier cosa»
  if (rutas.ruta !== undefined) return rutas.ruta === RUTA_ESQUEMAS;
  return !rutas.rutas || rutas.rutas.some((r) => r.toLowerCase() === RUTA_ESQUEMAS);
};

/** Engancha la recarga a los eventos del vault. Idempotente; solo en el navegador. */
function escuchar() {
  if (escuchando || typeof window === "undefined") return;
  escuchando = true;
  const alCambiar = (e: Event) => {
    if (tocaEsquemas(e)) void recargarEsquemas();
  };
  window.addEventListener(EVENTO_RECARGA, alCambiar);
  window.addEventListener(EVENTO_ARCHIVO_GUARDADO, alCambiar);
  useVaultStore.subscribe((s, previo) => {
    if (s.vaultId !== previo.vaultId) void recargarEsquemas();
  });
}

function suscribir(o: () => void): () => void {
  escuchar();
  oyentes.add(o);
  void asegurarEsquemas();
  return () => oyentes.delete(o);
}

/** Los esquemas, para un componente: se vuelve a pintar cuando cambian. */
export function useEsquemas(): ArchivoEsquemas {
  useSyncExternalStore(
    suscribir,
    () => version,
    () => 0,
  );
  return archivo;
}

// ── Validar ──────────────────────────────────────────────────────────────────

/** La nota del árbol, como la necesitan los esquemas (o una suelta si no está). */
function notaEsquema(id: string): NotaEsquema & { excluida: boolean } {
  const n = useVaultStore.getState().notas.find((x) => x.id === id);
  const barra = id.lastIndexOf("/");
  const nota = {
    id,
    carpetaId: n ? n.carpetaId : barra < 0 ? null : id.slice(0, barra),
    tipo: n?.tipo ?? (/\.md$/i.test(id) || !/\.[a-z0-9]+$/i.test(id) ? "markdown" : "otro"),
  };
  return { ...nota, excluida: excluida(nota, carpetaEsporas()) };
}

/**
 * Los avisos de propiedades de una nota con este texto (el del editor). Usa
 * los esquemas ya leídos: si todavía no se leyeron, pide la lectura y devuelve
 * por ahora solo el aviso del `#` (al terminar, las vistas se refrescan).
 */
export function avisosDeNota(id: string | null, texto: string): AvisoPropiedad[] {
  escuchar();
  if (id === null) return avisosAlmohadilla(texto);
  void asegurarEsquemas();
  const nota = notaEsquema(id);
  return validarPropiedades(nota, texto, archivo.esquemas, { excluida: nota.excluida });
}

// ── mycelium_validar_nota ────────────────────────────────────────────────────

registrarValidadorNota(async (ctx) => {
  const { esquemas } = await asegurarEsquemas();
  const nota = notaEsquema(ctx.nota.id);
  if (ctx.nota.tipo !== "markdown") return [];
  const avisos = validarPropiedades(nota, ctx.contenido, esquemas, { excluida: nota.excluida });
  return [chequeoPropiedades(avisos, nota.excluida ? 0 : cuantosAplican(nota, ctx.contenido, esquemas))];
});
