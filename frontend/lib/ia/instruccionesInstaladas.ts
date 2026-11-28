/**
 * Qué versión de las instrucciones de IA tiene instalada un vault, comparada
 * con la que trae la app (`FUN-S-45`). Lógica pura, sin imports: la usan el
 * store (`stores/instruccionesIaStore.ts`, que lee los archivos), la sección
 * de Configuración, el aviso de «Actividad de la IA» y `mycelium_estado`, y
 * se prueba con `scripts/test-instrucciones-instaladas.mjs`.
 *
 * Antes la versión instalada salía solo de `.claude/mycelium-ia.json`. Ese
 * marcador sigue siendo la fuente principal —`generarFramework` lo escribe
 * último, así que si algo falló antes queda la versión vieja—, pero no la
 * única: si los archivos quedaron con versiones mezcladas (una regeneración a
 * medias, una copia de otro vault, una skill restaurada de un respaldo), vale
 * la MÁS VIEJA, que es la que puede dejar a la IA sin saber algo.
 */

/** El marcador de versión que escribe `generarFramework`. */
export const RUTA_VERSION_IA = ".claude/mycelium-ia.json";

/**
 * Archivos de Mycelium que llevan `<!-- mycelium-ia vX.Y.Z -->` y se leen para
 * detectar versiones mezcladas. Las skills que la IA carga más a menudo, no
 * todas: con tres lecturas chicas alcanza para ver una regeneración a medias,
 * y esto corre al abrir el vault y al volver a la ventana.
 */
export const ARCHIVOS_CON_MARCA = [
  ".claude/skills/mycelium-vault/SKILL.md",
  ".claude/skills/mycelium-memoria/SKILL.md",
  ".claude/skills/mycelium-operar/SKILL.md",
] as const;

export type SituacionInstrucciones =
  /** El vault no tiene instrucciones: se crean solo si el usuario las pide. */
  | "sin-instrucciones"
  | "al-dia"
  /** Más viejas que las de la app: la IA no conoce lo nuevo. */
  | "desactualizadas"
  /** Más nuevas: el vault se actualizó desde una versión posterior de Mycelium. */
  | "mas-nuevas";

export type EstadoInstrucciones = {
  /** La versión que vale (la más vieja de las encontradas), o `null`. */
  instalada: string | null;
  disponible: string;
  situacion: SituacionInstrucciones;
  /** Los archivos tienen versiones distintas entre sí. */
  mezcladas: boolean;
};

/** Lo leído del vault: el texto de cada archivo, o `null` si no existe. */
export type LecturasInstrucciones = {
  json: string | null;
  claudeMd: string | null;
  marcas: (string | null)[];
};

const VERSION = /^\d+\.\d+\.\d+$/;

/** `"2.5.0"` → `[2, 5, 0]`, o `null` si no es una versión X.Y.Z. */
function partes(v: string): [number, number, number] | null {
  const limpia = v.trim().replace(/^v/, "").split(/[-+]/)[0];
  if (!VERSION.test(limpia)) return null;
  const [a, b, c] = limpia.split(".").map(Number);
  return [a, b, c];
}

/** Negativo si `a` es más vieja que `b`, 0 si son iguales, positivo si es más nueva. */
export function compararVersiones(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** La versión del marcador JSON, o `null` si falta o no se entiende. */
export function versionDelJson(texto: string | null): string | null {
  if (!texto) return null;
  try {
    const v = (JSON.parse(texto) as { version?: unknown }).version;
    return typeof v === "string" && partes(v) ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * La versión del `CLAUDE.md`: la del bloque gestionado (`<!-- mycelium:inicio
 * vX`, al principio de una línea) si lo hay. Solo sin bloque se mira la marca
 * de la 1.x (`<!-- mycelium-ia vX -->` en su propia línea): con el bloque
 * puesto, una marca vieja debajo son las instrucciones de antes que el usuario
 * editó y todavía no borró (`insertado-sobre-anterior`), no lo instalado.
 */
export function versionDeClaudeMd(texto: string | null): string | null {
  if (!texto) return null;
  const bloque = /^﻿?<!-- mycelium:inicio v(\d+\.\d+\.\d+)/m.exec(texto);
  if (bloque) return bloque[1];
  return versionDeMarca(texto);
}

/** La primera `<!-- mycelium-ia vX.Y.Z -->` en su propia línea, o `null`. */
export function versionDeMarca(texto: string | null): string | null {
  if (!texto) return null;
  const m = /^﻿?<!-- mycelium-ia v(\d+\.\d+\.\d+) -->\s*$/m.exec(texto);
  return m ? m[1] : null;
}

/**
 * Decide la situación. Sin ninguna versión en ningún archivo, no hay
 * instrucciones. Con varias, vale la más vieja.
 */
export function estadoInstrucciones(lecturas: LecturasInstrucciones, disponible: string): EstadoInstrucciones {
  const encontradas = [
    versionDelJson(lecturas.json),
    versionDeClaudeMd(lecturas.claudeMd),
    ...lecturas.marcas.map(versionDeMarca),
  ].filter((v): v is string => v !== null);
  if (encontradas.length === 0) {
    return { instalada: null, disponible, situacion: "sin-instrucciones", mezcladas: false };
  }
  const instalada = encontradas.reduce((min, v) => (compararVersiones(v, min) < 0 ? v : min));
  const mezcladas = encontradas.some((v) => compararVersiones(v, instalada) !== 0);
  const cmp = compararVersiones(instalada, disponible);
  const situacion: SituacionInstrucciones = cmp < 0 ? "desactualizadas" : cmp > 0 ? "mas-nuevas" : "al-dia";
  return { instalada, disponible, situacion, mezcladas };
}

/**
 * Lo que va en `mycelium_estado` (lo redacta el servidor en Rust), o `null`
 * si no hay instrucciones o todavía no se leyeron: sin instrucciones, la IA
 * no tiene nada que comparar.
 */
export function instruccionesParaIa(
  e: EstadoInstrucciones | null,
): { instalada: string; disponible: string; desactualizadas: boolean; mas_nuevas: boolean } | null {
  if (!e || e.instalada === null) return null;
  return {
    instalada: e.instalada,
    disponible: e.disponible,
    desactualizadas: e.situacion === "desactualizadas",
    mas_nuevas: e.situacion === "mas-nuevas",
  };
}
